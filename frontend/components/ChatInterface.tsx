'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Loader2, Sparkles, Check, X } from 'lucide-react';

type Message = {
  role: 'user' | 'bot';
  content: string;
  hitl_pending?: boolean;
  hitl_action?: string;
  hitl_reason?: string;
  message_id?: number;
};

export default function ChatInterface({ tenantId }: { tenantId: string }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', content: 'Hello! How can I assist you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (messageText?: string) => {
    const userMessage = messageText || input;
    if (!userMessage.trim() || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, tenant_id: tenantId }),
      });
      const data = await response.json();
      
      const botMessage: Message = {
        role: 'bot',
        content: data.response || '⚠️ No response from server.',
        hitl_pending: data.hitl_pending || false,
        hitl_action: data.hitl_action,
        hitl_reason: data.hitl_reason,
        message_id: Date.now(),
      };
      
      setMessages((prev) => [...prev, botMessage]);
    } catch {
      setMessages((prev) => [...prev, { role: 'bot', content: '⚠️ Connection failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleHITLApprove = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/chat/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, approve: true }),
      });
      const data = await response.json();
      setMessages((prev) => [...prev, { 
        role: 'bot', 
        content: data.response || '✅ Action approved and executed.',
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'bot', content: '⚠️ Failed to approve action.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleHITLReject = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/chat/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, approve: false }),
      });
      const data = await response.json();
      setMessages((prev) => [...prev, { 
        role: 'bot', 
        content: data.response || '❌ Action rejected.',
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'bot', content: '⚠️ Failed to reject action.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    // FIX: Replaced `h-150` and `max-w-2xl` with `h-full w-full`. Removed card borders/shadows for an edge-to-edge fit.
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-3 bg-card">
        <div className="p-2 bg-primary/10 rounded-full text-primary">
          <Sparkles size={20} />
        </div>
        <h2 className="font-semibold text-card-foreground">Support Assistant</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
        {/* Optional: If messages stretch too wide on desktop, you can wrap this mapping in a <div className="max-w-4xl mx-auto w-full"> */}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'bot' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {m.role === 'bot' ? <Bot size={16} /> : <User size={16} />}
            </div>
            <div className={`p-4 rounded-xl max-w-[80%] ${m.role === 'bot' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'}`}>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
              {/* HITL Approval Buttons */}
              {m.hitl_pending && (
                <div className="mt-4 flex items-center gap-3 border-t border-border/50 pt-3">
                  <button
                    onClick={handleHITLApprove}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <Check className="size-4" />
                    Approve
                  </button>
                  <button
                    onClick={handleHITLReject}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                  >
                    <X className="size-4" />
                    Reject
                  </button>
                  {m.hitl_action && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      Action: {m.hitl_action}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
              <Bot size={16} />
            </div>
            <div className="p-4 bg-muted text-muted-foreground rounded-xl flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} />
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border bg-card">
        {/* Optional: Add mx-auto max-w-4xl here too if you center the messages above */}
        <div className="flex items-center gap-2 bg-input/50 p-2 rounded-lg focus-within:ring-2 ring-ring transition-all">
          <input 
            className="flex-1 bg-transparent px-3 py-1 outline-none text-foreground placeholder:text-muted-foreground" 
            placeholder="Ask anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button 
            onClick={() => sendMessage()}
            disabled={loading}
            className="p-2 bg-primary text-primary-foreground hover:opacity-90 rounded-md transition-colors disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}