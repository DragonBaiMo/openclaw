import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

export function parseInsertCommandText(text: string): { isInsert: boolean; prompt: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { isInsert: false, prompt: "" };
  }
  const match = trimmed.match(/^\/insert(?=$|\s|:)(?:\s+|:)?([\s\S]*)$/i);
  if (!match) {
    return { isInsert: false, prompt: trimmed };
  }
  return {
    isInsert: true,
    prompt: (match[1] ?? "").trim(),
  };
}

export const handleInsertCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const sourceBody =
    typeof params.ctx.CommandBody === "string"
      ? params.ctx.CommandBody
      : typeof params.ctx.RawBody === "string"
        ? params.ctx.RawBody
        : typeof params.ctx.Body === "string"
          ? params.ctx.Body
          : params.command.commandBodyNormalized;
  const parsed = parseInsertCommandText(sourceBody);
  const fallbackParsed =
    parsed.isInsert || sourceBody === params.command.commandBodyNormalized
      ? parsed
      : parseInsertCommandText(params.command.commandBodyNormalized);
  if (!fallbackParsed.isInsert) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /insert from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!fallbackParsed.prompt) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /insert <message>" },
    };
  }

  params.ctx.CommandBody = fallbackParsed.prompt;
  params.ctx.Body = fallbackParsed.prompt;
  params.command.commandBodyNormalized = fallbackParsed.prompt;
  params.command.rawBodyNormalized = fallbackParsed.prompt;

  // /insert 语义（自定义强化）：仅做“当前回合边界注入”，不允许自动回退到下一轮。
  // 若当前 run 不可注入（非 streaming / compacting / 无 active run），由上层直接返回提示，不排队。
  params.directives = {
    ...params.directives,
    queueMode: "steer",
  };

  return { shouldContinue: true, insertBoundaryOnly: true, insertOneShotNext: true };
};
