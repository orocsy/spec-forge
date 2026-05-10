/**
 * Streaming chat endpoint — example built on the Vercel AI SDK.
 *
 * Test:
 *   curl -X POST http://localhost:3000/api/chat \
 *     -H 'Content-Type: application/json' \
 *     -d '{"messages":[{"role":"user","content":"hello"}]}'
 *
 * From the browser, pair with the AI SDK's `useChat` hook for the
 * streaming UI:
 *
 *   'use client';
 *   import { useChat } from 'ai/react';
 *   ...
 */
import { streamText } from 'ai';
import { aiModel } from '@/lib/ai';

// Allow streams up to 30 seconds (Vercel + most edge providers).
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: aiModel,
    messages,
  });

  return result.toUIMessageStreamResponse();
}
