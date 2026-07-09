'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatInterface() {
  const [messages, setMessages] = useState([
    { role: 'bot', content: 'Hello! Welcome to Allianz Customer Service. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    // 1. Add user message
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setLoading(true);

    try {
      // 2. Fetch from your Python backend
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();

      // 3. Add AI response
      setMessages((prev) => [...prev, { role: 'bot', content: data.response }]);
    } catch (error) {
      setMessages((prev) => [...prev, { 
        role: 'bot', 
        content: '⚠️ Sorry, I am having trouble connecting to the backend. Ensure your FastAPI server is running on port 8000.' 
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-600px w-full max-w-2xl border rounded-2xl shadow-xl overflow-hidden bg-white">
      {/* Chat History Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((m, i) => (
          <div 
            key={i} 
            className={`p-4 rounded-2xl max-w-[85%] ${
              m.role === 'bot' 
                ? 'bg-gray-100 text-black rounded-bl-none' 
                : 'bg-blue-600 text-white ml-auto rounded-br-none'
            }`}
          >
            {/* Markdown Rendering with Tailwind Typography */}
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>
                {m.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="p-4 bg-gray-100 rounded-2xl rounded-bl-none w-fit text-gray-500 italic">
            AI is thinking...
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t p-4 bg-white text-black">
        <input 
          className="w-full outline-none text-base" 
          placeholder="Type your question here..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          disabled={loading}
        />
      </div>
    </div>
  );
}