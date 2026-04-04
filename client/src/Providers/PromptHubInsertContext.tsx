// Created: 2026-04-03 by Nolan DeSchryver and Claude (claude-sonnet-4-6)
// Last updated: 2026-04-03 by Nolan DeSchryver
// Purpose: Scoped in-memory context for PromptHub insert callback token.
//          Replaces localStorage so the token is isolated per tab/ChatView instance.

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type TPromptHubInsertContext = {
  pendingCallbackToken: string | null;
  setPendingCallbackToken: (token: string | null) => void;
};

const PromptHubInsertContext = createContext<TPromptHubInsertContext>({
  pendingCallbackToken: null,
  setPendingCallbackToken: () => undefined,
});

export function PromptHubInsertProvider({ children }: { children: ReactNode }) {
  const [pendingCallbackToken, setPendingCallbackToken] = useState<string | null>(null);

  return (
    <PromptHubInsertContext.Provider value={{ pendingCallbackToken, setPendingCallbackToken }}>
      {children}
    </PromptHubInsertContext.Provider>
  );
}

export const usePromptHubInsertContext = () => useContext(PromptHubInsertContext);
