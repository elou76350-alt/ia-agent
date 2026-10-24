import type { ReactNode } from 'react';
import type { AppData, Message } from './types';
import { validData } from './data';

export interface StoredWorkspace {
  version: 1;
  data: AppData;
  messages: Message[];
  isDemo: boolean;
  habitDate: string;
}

export interface AccountSession {
  authRequired: boolean;
  user: { username: string } | null;
  initialWorkspace: StoredWorkspace | null;
  initialRevision: number;
  onLogout: () => Promise<void>;
}

export interface AccountGateProps { children: (session: AccountSession) => ReactNode }

export function validStoredWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== 'object') return false;
  const item = value as StoredWorkspace;
  return item.version === 1 && validData(item.data) && typeof item.isDemo === 'boolean'
    && typeof item.habitDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.habitDate)
    && Array.isArray(item.messages) && item.messages.length <= 60
    && item.messages.every(message => message && typeof message.id === 'string' && message.id.length <= 200
      && (message.role === 'assistant' || message.role === 'user')
      && typeof message.content === 'string' && message.content.length <= (message.role === 'user' ? 4000 : 12000)
      && (message.mode === undefined || message.mode === 'discovery' || message.mode === 'connected'));
}
