// Unit tests for PromptHubInsertContext and the HoverButtons auto-callback useEffect
// Created: 2026-04-06 by Nolan DeSchryver and Claude (claude-sonnet-4-6)
// Last modified: 2026-04-06 by Nolan DeSchryver
// No server required — fetch is mocked globally.

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  PromptHubInsertProvider,
  usePromptHubInsertContext,
} from '../PromptHubInsertContext';

// ---------------------------------------------------------------------------
// PromptHubInsertContext
// ---------------------------------------------------------------------------

describe('PromptHubInsertContext', () => {
  test('default pendingCallbackToken is null', () => {
    const { result } = renderHook(() => usePromptHubInsertContext(), {
      wrapper: PromptHubInsertProvider,
    });

    expect(result.current.pendingCallbackToken).toBeNull();
  });

  test('setPendingCallbackToken updates the token value', () => {
    const { result } = renderHook(() => usePromptHubInsertContext(), {
      wrapper: PromptHubInsertProvider,
    });

    act(() => {
      result.current.setPendingCallbackToken('my-token-abc');
    });

    expect(result.current.pendingCallbackToken).toBe('my-token-abc');
  });

  test('setPendingCallbackToken can clear the token back to null', () => {
    const { result } = renderHook(() => usePromptHubInsertContext(), {
      wrapper: PromptHubInsertProvider,
    });

    act(() => {
      result.current.setPendingCallbackToken('some-token');
    });
    act(() => {
      result.current.setPendingCallbackToken(null);
    });

    expect(result.current.pendingCallbackToken).toBeNull();
  });

  test('multiple consumers share the same context value', () => {
    let consumer1: ReturnType<typeof usePromptHubInsertContext> | null = null;
    let consumer2: ReturnType<typeof usePromptHubInsertContext> | null = null;

    function Consumer1() {
      consumer1 = usePromptHubInsertContext();
      return null;
    }
    function Consumer2() {
      consumer2 = usePromptHubInsertContext();
      return null;
    }

    render(
      <PromptHubInsertProvider>
        <Consumer1 />
        <Consumer2 />
      </PromptHubInsertProvider>,
    );

    act(() => {
      consumer1!.setPendingCallbackToken('shared-token');
    });

    expect(consumer2!.pendingCallbackToken).toBe('shared-token');
  });
});

// ---------------------------------------------------------------------------
// HoverButtons auto-callback useEffect
// The useEffect fires when: isLast && !isSubmitting && !isCreatedByUser && pendingCallbackToken
// We test the logic by simulating those conditions directly against the context
// and a minimal component that mirrors the effect.
// ---------------------------------------------------------------------------

describe('HoverButtons callback useEffect logic', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A minimal component that replicates the HoverButtons useEffect
  function CallbackEffect({
    isLast,
    isSubmitting,
    isCreatedByUser,
    messageId,
    token,
  }: {
    isLast: boolean;
    isSubmitting: boolean;
    isCreatedByUser: boolean;
    messageId: string;
    token?: string;
  }) {
    const { pendingCallbackToken, setPendingCallbackToken } = usePromptHubInsertContext();

    React.useEffect(() => {
      if (isCreatedByUser || !isLast || isSubmitting || !pendingCallbackToken) {
        return;
      }

      const callbackToken = pendingCallbackToken;
      setPendingCallbackToken(null);

      (async () => {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers.Authorization = `Bearer ${token}`;
          await fetch('/api/prompthub/response-callback', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ callbackToken, messageId }),
          });
        } catch {
          // swallowed intentionally
        }
      })();
    }, [isLast, isSubmitting, isCreatedByUser, messageId, pendingCallbackToken, setPendingCallbackToken, token]);

    return null;
  }

  function Wrapper({
    initialToken,
    isLast = true,
    isSubmitting = false,
    isCreatedByUser = false,
    messageId = 'msg-abc',
  }: {
    initialToken: string | null;
    isLast?: boolean;
    isSubmitting?: boolean;
    isCreatedByUser?: boolean;
    messageId?: string;
  }) {
    return (
      <PromptHubInsertProvider>
        <TokenSetter token={initialToken} />
        <CallbackEffect
          isLast={isLast}
          isSubmitting={isSubmitting}
          isCreatedByUser={isCreatedByUser}
          messageId={messageId}
        />
      </PromptHubInsertProvider>
    );
  }

  function TokenSetter({ token }: { token: string | null }) {
    const { setPendingCallbackToken } = usePromptHubInsertContext();
    React.useEffect(() => {
      setPendingCallbackToken(token);
    }, [token, setPendingCallbackToken]);
    return null;
  }

  test('fires fetch when all trigger conditions are met', async () => {
    await act(async () => {
      render(
        <Wrapper
          initialToken="cb-token-abc"
          isLast={true}
          isSubmitting={false}
          isCreatedByUser={false}
          messageId="msg-123"
        />,
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/prompthub/response-callback');
    const body = JSON.parse(options.body);
    expect(body.callbackToken).toBe('cb-token-abc');
    expect(body.messageId).toBe('msg-123');
  });

  test('does NOT fire fetch when isSubmitting is true', async () => {
    await act(async () => {
      render(
        <Wrapper initialToken="cb-token-abc" isLast={true} isSubmitting={true} />,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does NOT fire fetch when isLast is false', async () => {
    await act(async () => {
      render(
        <Wrapper initialToken="cb-token-abc" isLast={false} isSubmitting={false} />,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does NOT fire fetch when message is from user', async () => {
    await act(async () => {
      render(
        <Wrapper initialToken="cb-token-abc" isLast={true} isCreatedByUser={true} />,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does NOT fire fetch when pendingCallbackToken is null', async () => {
    await act(async () => {
      render(
        <Wrapper initialToken={null} isLast={true} isSubmitting={false} />,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});