#!/usr/bin/env node
// Meta Ads local stdio MCP server for kashklicks.
//
// Safety defaults:
//   - All create_* tools force status=PAUSED; campaigns must be activated
//     explicitly via set_status. Prevents accidental live ad spend.
//   - delete_* tools take a typed confirmation argument.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { meta } from './meta-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../.env.local') });

const OK = (result) => ({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
const ERR = (err) => ({ content: [{ type: 'text', text: `Error: ${err.message || err}` }], isError: true });

// ─── Tool definitions ──────────────────────────────────────────────────────

const tools = [
  {
    name: 'account_info',
    description: 'Fetch ad account metadata: balance, currency, timezone, lifetime spend, spend cap.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return meta.get(`/${meta.adAccountId()}`, {
        fields: 'id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance,disable_reason',
      });
    },
  },

  // ─── Read ────────────────────────────────────────────────────────────────
  {
    name: 'list_campaigns',
    description: 'List campaigns in the ad account. Returns id, name, status, objective, budget.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Page size (default 50)', default: 50 },
        effective_status: { type: 'array', items: { type: 'string' }, description: 'Filter e.g. ["ACTIVE","PAUSED"]' },
      },
    },
    handler: async (args) => {
      const query = {
        fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
        limit: args.limit ?? 50,
      };
      if (args.effective_status) query.effective_status = JSON.stringify(args.effective_status);
      return meta.get(`/${meta.adAccountId()}/campaigns`, query);
    },
  },
  {
    name: 'get_campaign',
    description: 'Fetch one campaign with its ad sets and ads inline.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
    },
    handler: async ({ campaign_id }) => {
      return meta.get(`/${campaign_id}`, {
        fields:
          'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,special_ad_categories,' +
          'adsets{id,name,status,effective_status,daily_budget,optimization_goal,billing_event,targeting,start_time,end_time},' +
          'ads{id,name,status,effective_status,creative{id,name,title,body}}',
      });
    },
  },
  {
    name: 'list_adsets',
    description: 'List ad sets in a specific campaign or the whole account.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Scope to one campaign (omit for account-wide)' },
        limit: { type: 'number', default: 50 },
      },
    },
    handler: async ({ campaign_id, limit = 50 }) => {
      const parent = campaign_id || meta.adAccountId();
      return meta.get(`/${parent}/adsets`, {
        fields: 'id,name,campaign_id,status,effective_status,daily_budget,optimization_goal,billing_event,targeting,bid_strategy',
        limit,
      });
    },
  },
  {
    name: 'list_ads',
    description: 'List ads in an ad set, campaign, or the whole account.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'adset_id, campaign_id, or omit for account' },
        limit: { type: 'number', default: 50 },
      },
    },
    handler: async ({ parent_id, limit = 50 }) => {
      const parent = parent_id || meta.adAccountId();
      return meta.get(`/${parent}/ads`, {
        fields: 'id,name,status,effective_status,campaign_id,adset_id,creative{id,title,body,image_url,object_story_spec}',
        limit,
      });
    },
  },
  {
    name: 'insights',
    description: 'Get performance insights for a campaign/adset/ad or the whole account.',
    inputSchema: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: 'campaign_id | adset_id | ad_id | omit for account-level' },
        date_preset: {
          type: 'string',
          description: 'today, yesterday, last_7d, last_14d, last_30d, this_month, lifetime, etc.',
          default: 'last_7d',
        },
        level: {
          type: 'string',
          enum: ['account', 'campaign', 'adset', 'ad'],
          description: 'Breakdown level',
        },
        fields: {
          type: 'string',
          description: 'Comma-separated metric list',
          default: 'impressions,clicks,ctr,cpc,cpm,spend,reach,frequency,actions,action_values,cost_per_action_type',
        },
      },
    },
    handler: async ({ object_id, date_preset = 'last_7d', level, fields }) => {
      const parent = object_id || meta.adAccountId();
      const query = { date_preset, fields: fields || 'impressions,clicks,ctr,cpc,cpm,spend,actions' };
      if (level) query.level = level;
      return meta.get(`/${parent}/insights`, query);
    },
  },

  // ─── Create (PAUSED by default) ──────────────────────────────────────────
  {
    name: 'create_campaign',
    description:
      'Create a PAUSED campaign. Use set_status to go live after review. Objective must be one of Meta\'s 2024+ OUTCOME_* values (OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_APP_PROMOTION, OUTCOME_SALES). For special categories like housing/credit/employment, pass special_ad_categories.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        objective: {
          type: 'string',
          enum: ['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_SALES'],
        },
        daily_budget_cents: { type: 'number', description: 'Daily budget in cents (CAD). Omit if using ad-set-level budget.' },
        lifetime_budget_cents: { type: 'number', description: 'Lifetime budget in cents (CAD). Alternative to daily_budget.' },
        special_ad_categories: {
          type: 'array',
          items: { type: 'string', enum: ['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS', 'ONLINE_GAMBLING_AND_GAMING', 'FINANCIAL_PRODUCTS_SERVICES'] },
          description: 'Defaults to [] (no special category)',
        },
        buying_type: { type: 'string', enum: ['AUCTION', 'RESERVED'], default: 'AUCTION' },
      },
      required: ['name', 'objective'],
    },
    handler: async (args) => {
      const body = {
        name: args.name,
        objective: args.objective,
        status: 'PAUSED', // always PAUSED on create
        special_ad_categories: JSON.stringify(args.special_ad_categories ?? []),
        buying_type: args.buying_type ?? 'AUCTION',
      };
      if (args.daily_budget_cents) body.daily_budget = String(args.daily_budget_cents);
      if (args.lifetime_budget_cents) body.lifetime_budget = String(args.lifetime_budget_cents);
      return meta.post(`/${meta.adAccountId()}/campaigns`, body);
    },
  },
  {
    name: 'create_adset',
    description:
      'Create a PAUSED ad set under a campaign. Targeting is a Meta Targeting object (JSON). Common optimization_goal values for lead/traffic: LINK_CLICKS, LANDING_PAGE_VIEWS, LEAD_GENERATION, OFFSITE_CONVERSIONS, REACH, IMPRESSIONS. billing_event is usually IMPRESSIONS.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        campaign_id: { type: 'string' },
        daily_budget_cents: { type: 'number' },
        lifetime_budget_cents: { type: 'number' },
        optimization_goal: { type: 'string' },
        billing_event: { type: 'string', default: 'IMPRESSIONS' },
        bid_amount_cents: { type: 'number', description: 'Optional max bid in cents' },
        targeting: {
          type: 'object',
          description:
            'Meta Targeting object. Example (Toronto, CA): { geo_locations: { cities: [{ key: "296875", radius: 40, distance_unit: "kilometer" }] }, age_min: 25, age_max: 38, genders: [1,2], publisher_platforms: ["instagram","facebook"], facebook_positions: ["feed"], instagram_positions: ["stream","reels","story"], targeting_automation: { advantage_audience: 0 } }. Look up city keys via GET /v21.0/search?type=adgeolocation&q=<city>&location_types=["city"].',
        },
        start_time: { type: 'string', description: 'ISO 8601' },
        end_time: { type: 'string', description: 'ISO 8601 (required if using lifetime_budget)' },
        promoted_object: {
          type: 'object',
          description: 'e.g. { pixel_id: "123", custom_event_type: "LEAD" } for conversion optimization, or { page_id: "123" } for Page Likes',
        },
      },
      required: ['name', 'campaign_id', 'optimization_goal', 'targeting'],
    },
    handler: async (args) => {
      const body = {
        name: args.name,
        campaign_id: args.campaign_id,
        status: 'PAUSED',
        optimization_goal: args.optimization_goal,
        billing_event: args.billing_event || 'IMPRESSIONS',
        targeting: JSON.stringify(args.targeting),
      };
      if (args.daily_budget_cents) body.daily_budget = String(args.daily_budget_cents);
      if (args.lifetime_budget_cents) body.lifetime_budget = String(args.lifetime_budget_cents);
      if (args.bid_amount_cents) body.bid_amount = String(args.bid_amount_cents);
      if (args.start_time) body.start_time = args.start_time;
      if (args.end_time) body.end_time = args.end_time;
      if (args.promoted_object) body.promoted_object = JSON.stringify(args.promoted_object);
      return meta.post(`/${meta.adAccountId()}/adsets`, body);
    },
  },
  {
    name: 'upload_image',
    description: 'Upload an image to the ad account image library. Returns the image_hash used by ad creatives. Accepts either a local file path or a public URL.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Local absolute path (preferred)' },
        url: { type: 'string', description: 'Public URL (Meta will fetch)' },
      },
    },
    handler: async ({ file_path, url }) => {
      if (!file_path && !url) throw new Error('Provide file_path or url');
      if (url) {
        return meta.post(`/${meta.adAccountId()}/adimages`, { url });
      }
      const buf = readFileSync(file_path);
      const filename = file_path.split('/').pop();
      const blob = new Blob([buf]);
      return meta.postForm(`/${meta.adAccountId()}/adimages`, { filename: blob });
    },
  },
  {
    name: 'create_ad_creative',
    description:
      'Create a reusable ad creative. For a single-image link ad, supply object_story_spec with link_data: { image_hash, link, message, name (headline), description, call_to_action: { type: "LEARN_MORE" | "SIGN_UP" | ..., value: { link } } }.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        object_story_spec: {
          type: 'object',
          description: 'Meta ObjectStorySpec. Must include page_id; defaults to META_PAGE_ID if omitted.',
        },
        degrees_of_freedom_spec: {
          type: 'object',
          description: 'Optional. For Advantage+ creative, controls what optimizations Meta may apply.',
        },
      },
      required: ['name', 'object_story_spec'],
    },
    handler: async (args) => {
      const spec = { ...args.object_story_spec };
      if (!spec.page_id) spec.page_id = meta.pageId();
      const body = {
        name: args.name,
        object_story_spec: JSON.stringify(spec),
      };
      if (args.degrees_of_freedom_spec) body.degrees_of_freedom_spec = JSON.stringify(args.degrees_of_freedom_spec);
      return meta.post(`/${meta.adAccountId()}/adcreatives`, body);
    },
  },
  {
    name: 'create_ad',
    description: 'Create a PAUSED ad in an ad set, bound to an existing creative.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        adset_id: { type: 'string' },
        creative_id: { type: 'string' },
      },
      required: ['name', 'adset_id', 'creative_id'],
    },
    handler: async ({ name, adset_id, creative_id }) => {
      return meta.post(`/${meta.adAccountId()}/ads`, {
        name,
        adset_id,
        creative: JSON.stringify({ creative_id }),
        status: 'PAUSED',
      });
    },
  },

  // ─── Mutate ──────────────────────────────────────────────────────────────
  {
    name: 'set_status',
    description:
      'Change status of a campaign, ad set, or ad. Use "ACTIVE" to go live — this is the ONLY tool that can move spend from paused to live. Other values: PAUSED, ARCHIVED.',
    inputSchema: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: 'campaign_id, adset_id, or ad_id' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] },
      },
      required: ['object_id', 'status'],
    },
    handler: async ({ object_id, status }) => meta.post(`/${object_id}`, { status }),
  },
  {
    name: 'update_campaign',
    description: 'Update arbitrary campaign fields (name, daily_budget, etc). Status changes should use set_status instead.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        updates: { type: 'object', description: 'Any valid Meta campaign field → value map' },
      },
      required: ['campaign_id', 'updates'],
    },
    handler: async ({ campaign_id, updates }) => meta.post(`/${campaign_id}`, updates),
  },
  {
    name: 'delete_object',
    description:
      'Permanently delete a campaign, ad set, ad, or creative. Requires confirm="DELETE" to proceed.',
    inputSchema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        confirm: { type: 'string', description: 'Must equal "DELETE"' },
      },
      required: ['object_id', 'confirm'],
    },
    handler: async ({ object_id, confirm }) => {
      if (confirm !== 'DELETE') throw new Error('Refusing to delete without confirm="DELETE"');
      return meta.del(`/${object_id}`);
    },
  },
];

// ─── Server wire-up ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'meta-ads', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return ERR(new Error(`Unknown tool: ${req.params.name}`));
  try {
    const result = await tool.handler(req.params.arguments || {});
    return OK(result);
  } catch (err) {
    return ERR(err);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
