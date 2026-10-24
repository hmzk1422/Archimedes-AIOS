import { NodeDefinition } from './types'

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = {
  // Input Nodes - Triggers and Webhooks
  telegram: {
    typeId: 'telegram',
    category: 'input',
    name: 'Telegram',
    description: 'Receive messages from Telegram bot',
    color: '#229ED9',
    icon: '✈️',
    fields: [
      {
        key: 'telegram_token',
        label: 'Bot Token',
        placeholder: '1234567890:AA...',
        type: 'password',
        required: true,
      },
    ],
    ports: [{ id: 'out-message', label: 'Message', type: 'output' }],
    defaultConfig: { telegram_token: '' },
  },

  whatsapp: {
    typeId: 'whatsapp',
    category: 'input',
    name: 'WhatsApp',
    description: 'Connect WhatsApp Cloud API',
    color: '#25D366',
    icon: '💬',
    fields: [
      {
        key: 'whatsapp_token',
        label: 'Access Token',
        placeholder: 'EAA...',
        type: 'password',
        required: true,
      },
      {
        key: 'whatsapp_phone_id',
        label: 'Phone Number ID',
        placeholder: '123456789012345',
        required: true,
      },
    ],
    ports: [{ id: 'out-message', label: 'Message', type: 'output' }],
    defaultConfig: { whatsapp_token: '', whatsapp_phone_id: '' },
  },

  webhook: {
    typeId: 'webhook',
    category: 'input',
    name: 'Webhook',
    description: 'Generic HTTP webhook receiver',
    color: '#8B5CF6',
    icon: '🔗',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL Path',
        placeholder: '/webhook/my-endpoint',
        required: true,
      },
      {
        key: 'webhook_secret',
        label: 'Secret (optional)',
        placeholder: 'shared-secret',
        type: 'password',
      },
    ],
    ports: [{ id: 'out-payload', label: 'Payload', type: 'output' }],
    defaultConfig: { webhook_url: '/webhook/custom', webhook_secret: '' },
  },

  email_trigger: {
    typeId: 'email_trigger',
    category: 'input',
    name: 'Email Trigger',
    description: 'Trigger workflow on incoming email',
    color: '#EA580C',
    icon: '📧',
    fields: [
      {
        key: 'imap_host',
        label: 'IMAP Host',
        placeholder: 'imap.gmail.com',
        required: true,
      },
      {
        key: 'email_address',
        label: 'Email Address',
        placeholder: 'your@email.com',
        type: 'email',
        required: true,
      },
    ],
    ports: [{ id: 'out-email', label: 'Email', type: 'output' }],
    defaultConfig: { imap_host: '', email_address: '' },
  },

  schedule: {
    typeId: 'schedule',
    category: 'input',
    name: 'Schedule',
    description: 'Trigger workflow on schedule',
    color: '#F59E0B',
    icon: '⏰',
    fields: [
      {
        key: 'cron',
        label: 'Cron Expression',
        placeholder: '0 9 * * *',
        required: true,
      },
    ],
    ports: [{ id: 'out-trigger', label: 'Trigger', type: 'output' }],
    defaultConfig: { cron: '0 9 * * *' },
  },

  // Processing Nodes - AI and Logic
  'ai-agent': {
    typeId: 'ai-agent',
    category: 'processing',
    name: 'AI Agent',
    description: 'Process messages through AI engine',
    color: '#EAB308',
    icon: '🤖',
    fields: [
      {
        key: 'system_prompt',
        label: 'System Prompt',
        placeholder: 'You are a helpful customer service agent...',
        type: 'text',
      },
      {
        key: 'temperature',
        label: 'Temperature',
        placeholder: '0.2',
        type: 'number',
      },
      {
        key: 'mode',
        label: 'AI Mode (knowledge base + instructions)',
        placeholder: 'Select a mode',
        type: 'select',
        options: [
          { label: 'Statarb', value: 'statarb' },
          { label: 'Investment', value: 'investment' },
        ],
      },
    ],
    ports: [
      { id: 'in-message', label: 'Input', type: 'input' },
      { id: 'out-response', label: 'Response', type: 'output' },
      { id: 'out-hitl', label: 'Needs Approval', type: 'output' },
    ],
    defaultConfig: { system_prompt: '', temperature: '0.2', mode: '' },
  },

  'hitl-gate': {
    typeId: 'hitl-gate',
    category: 'processing',
    name: 'HITL Gate',
    description: 'Require human approval based on your own rules',
    color: '#EF4444',
    icon: '👤',
    fields: [
      {
        key: 'rules',
        label: 'Approval Rules (JSON)',
        placeholder: '[{"field": "amount", "op": ">", "value": 50}, {"field": "sentiment", "op": "in", "value": ["negative","angry"]}]',
        type: 'json',
      },
      {
        key: 'approval_method',
        label: 'Approval Method',
        placeholder: 'dashboard',
        type: 'select',
        options: [
          { label: 'Dashboard', value: 'dashboard' },
          { label: 'Email', value: 'email' },
          { label: 'Both', value: 'both' },
        ],
      },
      {
        key: 'notify_email',
        label: 'Notification Email',
        placeholder: 'admin@company.com',
        type: 'email',
      },
      {
        key: 'timeout_minutes',
        label: 'Timeout (minutes)',
        placeholder: '30',
        type: 'number',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out-approved', label: 'Approved', type: 'output' },
      { id: 'out-rejected', label: 'Rejected', type: 'output' },
    ],
    defaultConfig: {
      rules: '[{"field": "amount", "op": ">", "value": 50}]',
      approval_method: 'dashboard',
      notify_email: '',
      timeout_minutes: '30',
    },
  },

  transform: {
    typeId: 'transform',
    category: 'processing',
    name: 'Transform',
    description: 'Transform data with template',
    color: '#A855F7',
    icon: '🔄',
    fields: [
      {
        key: 'template',
        label: 'Transform Template',
        placeholder: 'Use {{variable}} syntax',
        type: 'text',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out-transformed', label: 'Transformed', type: 'output' },
    ],
    defaultConfig: { template: '' },
  },

  condition: {
    typeId: 'condition',
    category: 'processing',
    name: 'Condition',
    description: 'Branch workflow based on conditions',
    color: '#06B6D4',
    icon: '🔀',
    fields: [
      {
        key: 'condition',
        label: 'Condition',
        placeholder: '{{value}} > 10',
        type: 'text',
        required: true,
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out-true', label: 'True', type: 'output' },
      { id: 'out-false', label: 'False', type: 'output' },
    ],
    defaultConfig: { condition: '' },
  },

    code: {
    typeId: 'code',
    category: 'processing',
    name: 'Code',
    description: 'Execute custom JavaScript code',
    color: '#6366F1',
    icon: '💻',
    fields: [
      {
        key: 'code',
        label: 'JavaScript Code',
        placeholder: '// Your code here\nreturn data;',
        type: 'text',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: { code: '' },
  },

  delay: {
    typeId: 'delay',
    category: 'processing',
    name: 'Delay',
    description: 'Wait a number of seconds before continuing the flow',
    color: '#6B7280',
    icon: '⏱️',
    fields: [
      {
        key: 'delay_seconds',
        label: 'Delay (seconds)',
        placeholder: '5',
        type: 'number',
        required: true,
      },
      {
        key: 'delay_mode',
        label: 'Delay Mode',
        type: 'select',
        options: [
          { label: 'Fixed seconds', value: 'fixed_seconds' },
          { label: 'Until time (ISO)', value: 'until_time' },
        ],
      },
      {
        key: 'until_time',
        label: 'Until (ISO timestamp)',
        placeholder: '2026-08-15T10:00:00Z',
        type: 'text',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: { delay_seconds: '5', delay_mode: 'fixed_seconds', until_time: '' },
  },

  router: {
    typeId: 'router',
    category: 'processing',
    name: 'Router',
    description: 'Route to different output branches based on a value',
    color: '#F97316',
    icon: '🔀',
    fields: [
      {
        key: 'field',
        label: 'Value to route on',
        placeholder: '{{response.category}}',
        required: true,
      },
      {
        key: 'routes',
        label: 'Routes (JSON array)',
        placeholder: '[{"value": "sales", "label": "Sales"}, {"value": "support", "label": "Support"}]',
        type: 'json',
      },
      {
        key: 'default_route',
        label: 'Default route label',
        placeholder: 'default',
        required: true,
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: { field: '', routes: '[]', default_route: 'default' },
  },

  loop: {
    typeId: 'loop',
    category: 'processing',
    name: 'Loop',
    description: 'Iterate over a list of items',
    color: '#EC4899',
    icon: '🔁',
    fields: [
      {
        key: 'collection',
        label: 'Collection expression',
        placeholder: '{{items}}',
        required: true,
      },
      {
        key: 'item_var',
        label: 'Item variable name',
        placeholder: 'item',
        required: true,
      },
      {
        key: 'max_iterations',
        label: 'Max iterations',
        placeholder: '100',
        type: 'number',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: { collection: '', item_var: 'item', max_iterations: '100' },
  },

  // Output Nodes - Actions and Responses
  database: {
    typeId: 'database',
    category: 'output',
    name: 'Database',
    description: 'Write results to Supabase',
    color: '#3ECF8E',
    icon: '🗄️',
    fields: [
      {
        key: 'table_name',
        label: 'Table Name',
        placeholder: 'conversations',
        required: true,
      },
      {
        key: 'operation',
        label: 'Operation',
        type: 'select',
        options: [
          { label: 'Insert', value: 'insert' },
          { label: 'Upsert', value: 'upsert' },
        ],
      },
    ],
    ports: [{ id: 'in', label: 'In', type: 'input' }],
    defaultConfig: { table_name: 'conversations', operation: 'insert' },
  },

  email: {
    typeId: 'email',
    category: 'output',
    name: 'Email',
    description: 'Send an email notification',
    color: '#EA580C',
    icon: '📧',
    fields: [
      {
        key: 'to',
        label: 'To',
        placeholder: 'recipient@example.com',
        type: 'email',
        required: true,
      },
      {
        key: 'subject_template',
        label: 'Subject Template',
        placeholder: 'New message from {{customer}}',
        required: true,
      },
    ],
    ports: [{ id: 'in', label: 'In', type: 'input' }],
    defaultConfig: { to: '', subject_template: '' },
  },

  'http-response': {
    typeId: 'http-response',
    category: 'output',
    name: 'HTTP Response',
    description: 'Send a response back to the caller',
    color: '#6366F1',
    icon: '📡',
    fields: [
      {
        key: 'status_code',
        label: 'Status Code',
        placeholder: '200',
        type: 'number',
      },
    ],
    ports: [{ id: 'in', label: 'In', type: 'input' }],
    defaultConfig: { status_code: '200' },
  },

  http_request: {
    typeId: 'http_request',
    category: 'output',
    name: 'HTTP Request',
    description: 'Make an outbound HTTP request',
    color: '#6366F1',
    icon: '📡',
    fields: [
      {
        key: 'method',
        label: 'Method',
        type: 'select',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' },
        ],
      },
      {
        key: 'url',
        label: 'URL',
        placeholder: 'https://api.example.com/endpoint',
        required: true,
      },
      {
        key: 'headers',
        label: 'Headers (JSON)',
        placeholder: '{"Authorization": "Bearer ..."}',
        type: 'json',
      },
      {
        key: 'body',
        label: 'Body (JSON)',
        placeholder: '{"key": "{{value}}"}',
        type: 'json',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: { method: 'GET', url: '', headers: '{}', body: '{}' },
  },

  metrics: {
    typeId: 'metrics',
    category: 'output',
    name: 'Metric',
    description:
      'Emit a dynamic metric (counter / gauge / distribution / boolean) to the telemetry store. One metrics node drives every dashboard domain — only `tags` differ.',
    color: '#38BDF8',
    icon: '📊',
    fields: [
      {
        key: 'metric_name',
        label: 'Metric Name',
        placeholder: 'e.g. contacts, probability, keyword',
        type: 'text',
        required: true,
      },
      {
        key: 'metric_type',
        label: 'Metric Type',
        type: 'select',
        options: [
          { value: 'counter', label: 'Counter' },
          { value: 'gauge', label: 'Gauge' },
          { value: 'distribution', label: 'Distribution' },
          { value: 'boolean', label: 'Boolean' },
        ],
      },
      {
        key: 'value_template',
        label: 'Value Template',
        placeholder: '{{response.duration_ms}}',
        type: 'text',
      },
      {
        key: 'value',
        label: 'Static Value',
        placeholder: '123',
        type: 'number',
      },
      {
        key: 'unit',
        label: 'Unit',
        placeholder: 'ms',
        type: 'text',
      },
      {
        key: 'tags',
        label: 'Tags (JSON)',
        placeholder: '{"channel":"whatsapp","risk":"high","intent":"bullying"}',
        type: 'json',
      },
      {
        key: 'evaluation_name',
        label: 'Evaluation Name',
        placeholder: 'e.g. CSAT, faithfulness',
        type: 'text',
      },
      {
        key: 'score_min',
        label: 'Score Min',
        type: 'number',
      },
      {
        key: 'score_max',
        label: 'Score Max',
        type: 'number',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Value', type: 'output' },
    ],
    defaultConfig: {
      metric_name: '',
      metric_type: 'counter',
      value_template: '',
      value: '',
      unit: '',
      tags: '{}',
      evaluation_name: '',
      score_min: '',
      score_max: '',
    },
  },

  slack: {
    typeId: 'slack',
    category: 'output',
    name: 'Slack',
    description: 'Send message to Slack channel',
    color: '#4A154B',
    icon: '💼',
    fields: [
      {
        key: 'slack_token',
        label: 'Bot Token',
        placeholder: 'xoxb-...',
        type: 'password',
        required: true,
      },
      {
        key: 'channel',
        label: 'Channel',
        placeholder: '#general',
        required: true,
      },
    ],
    ports: [{ id: 'in', label: 'In', type: 'input' }],
    defaultConfig: { slack_token: '', channel: '' },
  },

  telegram_send: {
    typeId: 'telegram_send',
    category: 'output',
    name: 'Telegram Send',
    description: 'Send message to Telegram chat',
    color: '#229ED9',
    icon: '✈️',
    fields: [
      {
        key: 'telegram_token',
        label: 'Bot Token',
        placeholder: '1234567890:AA...',
        type: 'password',
        required: true,
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        placeholder: '123456789',
        required: true,
      },
    ],
    ports: [{ id: 'in', label: 'In', type: 'input' }],
    defaultConfig: { telegram_token: '', chat_id: '' },
  },
}

export const CATEGORY_LABELS: Record<string, string> = {
  input: 'Triggers',
  processing: 'Logic & AI',
  output: 'Actions',
}