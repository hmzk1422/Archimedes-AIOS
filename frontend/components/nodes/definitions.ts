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

  metrics: {
    typeId: 'metrics',
    category: 'processing',
    name: 'Metrics',
    description: 'Record custom metrics and evaluations from the flow',
    color: '#3B82F6',
    icon: '📊',
    fields: [
      {
        key: 'metric_name',
        label: 'Metric Name',
        placeholder: 'conversation_duration_ms',
        required: true,
      },
      {
        key: 'metric_type',
        label: 'Metric Type',
        type: 'select',
        options: [
          { label: 'Counter', value: 'counter' },
          { label: 'Gauge', value: 'gauge' },
        ],
      },
      {
        key: 'value_template',
        label: 'Value Expression',
        placeholder: '{{response.duration_ms}} or 1',
        required: true,
      },
      {
        key: 'tags',
        label: 'Tags (JSON)',
        placeholder: '{"channel": "telegram", "tier": "enterprise"}',
        type: 'json',
      },
      {
        key: 'evaluation_name',
        label: 'Evaluation Name (optional)',
        placeholder: 'faithfulness',
      },
      {
        key: 'min_score',
        label: 'Min Score',
        placeholder: '0',
        type: 'number',
      },
      {
        key: 'max_score',
        label: 'Max Score',
        placeholder: '10',
        type: 'number',
      },
    ],
    ports: [
      { id: 'in', label: 'In', type: 'input' },
      { id: 'out', label: 'Out', type: 'output' },
    ],
    defaultConfig: {
      metric_name: '',
      metric_type: 'counter',
      value_template: '1',
      tags: '{}',
      evaluation_name: '',
      min_score: '0',
      max_score: '10',
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