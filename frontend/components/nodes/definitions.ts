import { NodeDefinition } from './types'

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = {
  telegram: {
    typeId: 'telegram',
    category: 'input',
    name: 'Telegram',
    description: 'Receive messages from a Telegram bot',
    color: '#229ED9',
    icon: '✈️',
    fields: [
      {
        key: 'telegram_token',
        label: 'Bot API Token',
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

  zendesk: {
    typeId: 'zendesk',
    category: 'input',
    name: 'Zendesk',
    description: 'Route Zendesk ticket messages through the agent',
    color: '#03363D',
    icon: '🏢',
    fields: [
      {
        key: 'zendesk_email',
        label: 'Zendesk Email',
        placeholder: 'agent@example.com',
        type: 'email',
        required: true,
      },
      {
        key: 'zendesk_token',
        label: 'API Token',
        placeholder: 'Zendesk API token',
        type: 'password',
        required: true,
      },
      {
        key: 'zendesk_subdomain',
        label: 'Subdomain',
        placeholder: 'your-company',
        required: true,
      },
    ],
    ports: [{ id: 'out-message', label: 'Message', type: 'output' }],
    defaultConfig: { zendesk_email: '', zendesk_token: '', zendesk_subdomain: '' },
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

  'ai-agent': {
    typeId: 'ai-agent',
    category: 'processing',
    name: 'AI Agent',
    description: 'Process messages through the AI engine',
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
    ],
    ports: [
      { id: 'in-message', label: 'Input', type: 'input' },
      { id: 'out-response', label: 'Response', type: 'output' },
      { id: 'out-hitl', label: 'Needs Approval', type: 'output' },
    ],
    defaultConfig: { system_prompt: '', temperature: '0.2' },
  },

  'hitl-gate': {
    typeId: 'hitl-gate',
    category: 'processing',
    name: 'HITL Gate',
    description: 'Require human approval before proceeding',
    color: '#EF4444',
    icon: '👤',
    fields: [
      {
        key: 'approval_method',
        label: 'Approval Method',
        placeholder: 'email',
        type: 'select',
        options: [
          { label: 'Email', value: 'email' },
          { label: 'Dashboard', value: 'dashboard' },
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
    defaultConfig: { approval_method: 'email', notify_email: '', timeout_minutes: '30' },
  },

  transform: {
    typeId: 'transform',
    category: 'processing',
    name: 'Transform',
    description: 'Transform data with a template',
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
}

export const CATEGORY_LABELS: Record<string, string> = {
  input: 'Input Nodes',
  processing: 'Processing Nodes',
  output: 'Output Nodes',
}