import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  const tenantId = process.env.NEXT_PUBLIC_TENANT_ID || 'allianz';
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-4xl text-center mb-8">
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
          Allianz Support
        </h1>
        <p className="text-muted-foreground mt-2">
          Your intelligent assistant is ready to help.
        </p>
      </div>
      <ChatInterface tenantId={tenantId} />
    </main>
  );
}