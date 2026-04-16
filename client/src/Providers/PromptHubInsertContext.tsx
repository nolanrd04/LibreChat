// Created: 2026-04-03 by Nolan DeSchryver and Claude (claude-sonnet-4-6)
// Last updated: 2026-04-03 by Nolan DeSchryver
// Purpose: Scoped in-memory context for PromptHub insert callback token.
//          Replaces localStorage so the token is isolated per tab/ChatView instance.

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type TPromptHubInsertContext = {
  pendingCallbackToken: string | null;
  pendingVersionId: number | null;
  setPendingCallbackToken: (token: string | null, versionId?: number | null) => void;
};

const PromptHubInsertContext = createContext<TPromptHubInsertContext>({
  pendingCallbackToken: null,
  pendingVersionId: null,
  setPendingCallbackToken: () => undefined,
});

export function PromptHubInsertProvider({ children }: { children: ReactNode }) {
  const [pendingCallbackToken, setPendingCallbackTokenState] = useState<string | null>(null);
  const [pendingVersionId, setPendingVersionIdState] = useState<number | null>(null);

  const setPendingCallbackToken = (token: string | null, versionId: number | null = null) => {
    setPendingCallbackTokenState(token);
    setPendingVersionIdState(versionId);
  };

  return (
    <PromptHubInsertContext.Provider value={{ pendingCallbackToken, pendingVersionId, setPendingCallbackToken }}>
      {children}
    </PromptHubInsertContext.Provider>
  );
}

export const usePromptHubInsertContext = () => useContext(PromptHubInsertContext);
