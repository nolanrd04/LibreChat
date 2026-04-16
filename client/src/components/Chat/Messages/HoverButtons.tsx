// Last modified: 2026-04-03 by Nolan DeSchryver
// 2026-04-03: Added useEffect to auto-fire PromptHub response callback on stream completion
//             by Nolan DeSchryver and Claude (claude-sonnet-4-6)

import React, { useState, useMemo, memo, useEffect, useRef } from 'react';
import { useRecoilState } from 'recoil';
import type { TConversation, TMessage, TFeedback } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import { EditIcon, Clipboard, CheckMark, ContinueIcon, RegenerateIcon } from '@librechat/client';
import { Upload, ExternalLink } from 'lucide-react';
import { NotificationSeverity } from '~/common';
import { useAuthContext } from '~/hooks/AuthContext';
import { usePromptHubInsertContext } from '~/Providers';
import { useGenerationsByLatest, useLocalize } from '~/hooks';
import { Fork } from '~/components/Conversations';
import MessageAudio from './MessageAudio';
import Feedback from './Feedback';
import { cn } from '~/utils';
import store from '~/store';

type THoverButtons = {
  isEditing: boolean;
  enterEdit: (cancel?: boolean) => void;
  copyToClipboard: (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => void;
  conversation: TConversation | null;
  isSubmitting: boolean;
  message: TMessage;
  regenerate: () => void;
  handleContinue: (e: React.MouseEvent<HTMLButtonElement>) => void;
  latestMessage: TMessage | null;
  isLast: boolean;
  index: number;
  handleFeedback?: ({ feedback }: { feedback: TFeedback | undefined }) => void;
};

type HoverButtonProps = {
  id?: string;
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  icon: React.ReactNode;
  isActive?: boolean;
  isVisible?: boolean;
  isDisabled?: boolean;
  isLast?: boolean;
  className?: string;
  buttonStyle?: string;
};

const extractMessageContent = (message: TMessage): string => {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part == null) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part) {
          return part.text || '';
        }
        if ('think' in part) {
          const think = part.think;
          if (typeof think === 'string') {
            return think;
          }
          return think && 'text' in think ? think.text || '' : '';
        }
        return '';
      })
      .join('');
  }

  return message.text || '';
};

const HoverButton = memo(
  ({
    id,
    onClick,
    title,
    icon,
    isActive = false,
    isVisible = true,
    isDisabled = false,
    isLast = false,
    className = '',
  }: HoverButtonProps) => {
    const buttonStyle = cn(
      'hover-button rounded-lg p-1.5 text-text-secondary-alt transition-colors duration-200',
      'hover:text-text-primary hover:bg-surface-hover',
      'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
      !isLast && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
      !isVisible && 'opacity-0',
      'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
      isActive && isVisible && 'active text-text-primary bg-surface-hover',
      className,
    );

    return (
      <button
        id={id}
        className={buttonStyle}
        onClick={onClick}
        type="button"
        title={title}
        disabled={isDisabled}
      >
        {icon}
      </button>
    );
  },
);

HoverButton.displayName = 'HoverButton';

const HoverButtons = ({
  index,
  isEditing,
  enterEdit,
  copyToClipboard,
  conversation,
  isSubmitting,
  message,
  regenerate,
  handleContinue,
  latestMessage,
  isLast,
  handleFeedback,
}: THoverButtons) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const { pendingCallbackToken, pendingVersionId, setPendingCallbackToken } = usePromptHubInsertContext();
  const [isCopied, setIsCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [promptHubUrl, setPromptHubUrl] = useState<string | null>(null);
  const [TextToSpeech] = useRecoilState<boolean>(store.textToSpeech);
  const callbackSentRef = useRef<string | null>(null);
  const lastCallbackMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (message.isCreatedByUser || !isLast || isSubmitting || !pendingCallbackToken || !pendingVersionId) {
      return;
    }

    // Prevent duplicate sends: only send once per callback token
    if (callbackSentRef.current === pendingCallbackToken) {
      return;
    }

    // Prevent sending callback for old responses when re-inserting the same prompt.
    // Only send if this is a NEW message (different from last callback message).
    if (lastCallbackMessageIdRef.current === message.messageId) {
      return;
    }

    // Mark this callback token as sent and track the message ID
    callbackSentRef.current = pendingCallbackToken;
    lastCallbackMessageIdRef.current = message.messageId;

    // Clear immediately to prevent re-entry.
    setPendingCallbackToken(null);

    const callbackToken = pendingCallbackToken;
    const versionId = pendingVersionId;

    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        await fetch('/api/prompthub/response-callback', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ callbackToken, messageId: message.messageId, versionId }),
        });
      } catch (_error) {
        // Silently fail - response tracking is not critical to user experience
      }
    })();
  }, [isLast, isSubmitting, message.isCreatedByUser, message.messageId, pendingCallbackToken, pendingVersionId, setPendingCallbackToken, token]);

  const endpoint = useMemo(() => {
    if (!conversation) {
      return '';
    }
    return conversation.endpointType ?? conversation.endpoint;
  }, [conversation]);

  const generationCapabilities = useGenerationsByLatest({
    isEditing,
    isSubmitting,
    error: message.error,
    endpoint: endpoint ?? '',
    messageId: message.messageId,
    searchResult: message.searchResult,
    finish_reason: message.finish_reason,
    isCreatedByUser: message.isCreatedByUser,
    latestMessageId: latestMessage?.messageId,
  });

  const {
    hideEditButton,
    regenerateEnabled,
    continueSupported,
    forkingSupported,
    isEditableEndpoint,
  } = generationCapabilities;

  if (!conversation) {
    return null;
  }

  const { isCreatedByUser, error } = message;

  if (error === true) {
    return (
      <div className="visible flex justify-center self-end lg:justify-start">
        {regenerateEnabled && (
          <HoverButton
            onClick={regenerate}
            title={localize('com_ui_regenerate')}
            icon={<RegenerateIcon size="19" />}
            isLast={isLast}
          />
        )}
      </div>
    );
  }

  const onEdit = () => {
    if (isEditing) {
      return enterEdit(true);
    }
    enterEdit();
  };

  const handleCopy = () => copyToClipboard(setIsCopied);

  const handleExport = async () => {
    if (!message.messageId || isExporting) {
      return;
    }

    setIsExporting(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch('/api/prompthub/export-message', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ messageId: message.messageId }),
      });

      const rawBody = await response.text();
      const data = (() => {
        try {
          return rawBody ? JSON.parse(rawBody) : {};
        } catch (_error) {
          return { message: rawBody || '' };
        }
      })();
      if (!response.ok) {
        throw new Error(data?.message || 'Unable to export message to PromptHub');
      }

      setPromptHubUrl(data?.prompthubUrl ?? null);
      showToast({
        message: 'Exported to PromptHub',
        severity: NotificationSeverity.SUCCESS,
      });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : 'Unable to export message to PromptHub',
        severity: NotificationSeverity.ERROR,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleViewPromptHub = () => {
    if (!promptHubUrl) {
      return;
    }
    window.open(promptHubUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="group visible flex justify-center gap-0.5 self-end focus-within:outline-none lg:justify-start">
      {/* Text to Speech */}
      {TextToSpeech && (
        <MessageAudio
          index={index}
          isLast={isLast}
          messageId={message.messageId}
          content={extractMessageContent(message)}
          renderButton={(props) => (
            <HoverButton
              onClick={props.onClick}
              title={props.title}
              icon={props.icon}
              isActive={props.isActive}
              isLast={isLast}
            />
          )}
        />
      )}

      {/* Copy Button */}
      <HoverButton
        onClick={handleCopy}
        title={
          isCopied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy_to_clipboard')
        }
        icon={isCopied ? <CheckMark className="h-[18px] w-[18px]" /> : <Clipboard size="19" />}
        isLast={isLast}
        className={`ml-0 flex items-center gap-1.5 text-xs ${isSubmitting && isCreatedByUser ? 'md:opacity-0 md:group-hover:opacity-100' : ''}`}
      />

      {/* Edit Button */}
      {isEditableEndpoint && (
        <HoverButton
          id={`edit-${message.messageId}`}
          onClick={onEdit}
          title={localize('com_ui_edit')}
          icon={<EditIcon size="19" />}
          isActive={isEditing}
          isVisible={!hideEditButton}
          isDisabled={hideEditButton}
          isLast={isLast}
          className={isCreatedByUser ? '' : 'active'}
        />
      )}

      {/* Fork Button */}
      <Fork
        messageId={message.messageId}
        conversationId={conversation.conversationId}
        forkingSupported={forkingSupported}
        latestMessageId={latestMessage?.messageId}
        isLast={isLast}
      />

      {/* Feedback Buttons */}
      {!isCreatedByUser && handleFeedback != null && (
        <Feedback handleFeedback={handleFeedback} feedback={message.feedback} isLast={isLast} />
      )}

      {!isCreatedByUser && (
        <HoverButton
          onClick={handleExport}
          title={isExporting ? 'Exporting to PromptHub...' : 'Export to PromptHub'}
          icon={<Upload size="19" />}
          isLast={isLast}
          isDisabled={isExporting}
          className="active"
        />
      )}

      {!isCreatedByUser && promptHubUrl && (
        <HoverButton
          onClick={handleViewPromptHub}
          title={'View in PromptHub'}
          icon={<ExternalLink size="19" />}
          isLast={isLast}
          className="active"
        />
      )}

      {/* Regenerate Button */}
      {regenerateEnabled && (
        <HoverButton
          onClick={regenerate}
          title={localize('com_ui_regenerate')}
          icon={<RegenerateIcon size="19" />}
          isLast={isLast}
          className="active"
        />
      )}

      {/* Continue Button */}
      {continueSupported && (
        <HoverButton
          onClick={(e) => e && handleContinue(e)}
          title={localize('com_ui_continue')}
          icon={<ContinueIcon className="w-19 h-19 -rotate-180" />}
          isLast={isLast}
          className="active"
        />
      )}
    </div>
  );
};

export default memo(HoverButtons);
