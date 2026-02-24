import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AgentHeartbeatStatus,
  AgentFileEntry,
  AgentsFilesGetResult,
  AgentsFilesListResult,
  AgentsFilesSetResult,
} from "../types.ts";

export type AgentFilesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentHeartbeatLoading: boolean;
  agentHeartbeatError: string | null;
  agentHeartbeatById: Record<string, AgentHeartbeatStatus | null>;
};

function mergeFileEntry(
  list: AgentsFilesListResult | null,
  entry: AgentFileEntry,
): AgentsFilesListResult | null {
  if (!list) {
    return list;
  }
  const hasEntry = list.files.some((file) => file.name === entry.name);
  const nextFiles = hasEntry
    ? list.files.map((file) => (file.name === entry.name ? entry : file))
    : [...list.files, entry];
  return { ...list, files: nextFiles };
}

export async function loadAgentFiles(state: AgentFilesState, agentId: string) {
  if (!state.client || !state.connected || state.agentFilesLoading) {
    return;
  }
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesListResult | null>("agents.files.list", {
      agentId,
    });
    if (res) {
      state.agentFilesList = res;
      if (state.agentFileActive && !res.files.some((file) => file.name === state.agentFileActive)) {
        state.agentFileActive = null;
      }
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFilesLoading = false;
  }
}

export async function loadAgentFileContent(
  state: AgentFilesState,
  agentId: string,
  name: string,
  opts?: { force?: boolean; preserveDraft?: boolean },
) {
  if (!state.client || !state.connected || state.agentFilesLoading) {
    return;
  }
  if (!opts?.force && Object.prototype.hasOwnProperty.call(state.agentFileContents, name)) {
    return;
  }
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesGetResult | null>("agents.files.get", {
      agentId,
      name,
    });
    if (res?.file) {
      const content = res.file.content ?? "";
      const previousBase = state.agentFileContents[name] ?? "";
      const currentDraft = state.agentFileDrafts[name];
      const preserveDraft = opts?.preserveDraft ?? true;
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [name]: content };
      if (
        !preserveDraft ||
        !Object.prototype.hasOwnProperty.call(state.agentFileDrafts, name) ||
        currentDraft === previousBase
      ) {
        state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
      }
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFilesLoading = false;
  }
}

export async function saveAgentFile(
  state: AgentFilesState,
  agentId: string,
  name: string,
  content: string,
) {
  if (!state.client || !state.connected || state.agentFileSaving) {
    return;
  }
  state.agentFileSaving = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request<AgentsFilesSetResult | null>("agents.files.set", {
      agentId,
      name,
      content,
    });
    if (res?.file) {
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [name]: content };
      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFileSaving = false;
  }
}

export async function loadAgentHeartbeatStatus(state: AgentFilesState, agentId: string) {
  if (!state.client || !state.connected || state.agentHeartbeatLoading) {
    return;
  }
  state.agentHeartbeatLoading = true;
  state.agentHeartbeatError = null;
  try {
    const res = await state.client.request<AgentHeartbeatStatus | null>("last-heartbeat.agent", {
      agentId,
    });
    state.agentHeartbeatById = { ...state.agentHeartbeatById, [agentId]: res ?? null };
  } catch (err) {
    state.agentHeartbeatError = String(err);
  } finally {
    state.agentHeartbeatLoading = false;
  }
}
