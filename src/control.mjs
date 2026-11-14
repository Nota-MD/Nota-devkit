import { call } from "./protocol.mjs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export function parseDocumentId(value) {
  if (value === undefined || value === null || value === "" || value === "active") {
    return null;
  }
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`Document id must be a positive integer or "active": ${text}`);
  }
  return Number(text);
}

export function activeDocument(status) {
  if (status?.active) return status.active;
  return Array.isArray(status?.documents)
    ? status.documents.find((document) => document.active === true) ?? null
    : null;
}

function clean(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
}

export function formatDocument(document, marker = " ") {
  const title = clean(document.title) || "Untitled";
  const path = document.path ? clean(document.path) : "(unsaved)";
  const flags = [
    document.active ? "active" : "",
    document.dirty ? "modified" : "",
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `${marker} [${document.id}] ${title}${suffix}\n    ${path}`;
}

export function formatDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return "No documents are open.";
  }
  return documents
    .map((document) => formatDocument(document, document.active ? "*" : " "))
    .join("\n");
}

export function formatStatus(status) {
  const active = activeDocument(status);
  const documents = Array.isArray(status?.documents) ? status.documents : [];
  return [
    `${status.app ?? "Nota"} ${status.version ?? ""}`.trim(),
    `Plugin API: ${status.apiVersion ?? "unknown"}`,
    `Active: ${
      active
        ? `[${active.id}] ${clean(active.title) || "Untitled"}${
            active.dirty ? " (modified)" : ""
          }`
        : "none"
    }`,
    `Documents (${documents.length}):`,
    formatDocuments(documents),
  ].join("\n");
}

export async function getEditorStatus(config) {
  const status = await call(config, "editor.status");
  if (!status || !Array.isArray(status.documents)) {
    throw new Error("Nota returned an invalid editor status");
  }
  return status;
}

export async function readDocument(config, id = null) {
  const result = await call(
    config,
    "documents.read",
    id === null ? {} : { id },
  );
  if (!result || typeof result.text !== "string") {
    throw new Error("Nota returned an invalid document");
  }
  return result;
}

export async function writeDocument(config, id, text) {
  return call(
    config,
    "documents.write",
    id === null ? { text } : { id, text },
  );
}

export async function openDocument(config, path) {
  return call(config, "documents.open", { path });
}

export async function listExtensions(config) {
  return call(config, "plugins.list");
}

export async function installExtension(config, file, { hostPath = false } = {}) {
  if (hostPath) {
    return call(config, "plugins.install", { path: resolve(file) });
  }
  const bytes = await readFile(file);
  return call(config, "plugins.install", {
    filename: basename(file),
    base64: bytes.toString("base64"),
  });
}

export async function uninstallExtension(config, id) {
  return call(config, "plugins.uninstall", { id });
}

export async function setExtensionEnabled(config, id, enabled) {
  return call(config, "plugins.setEnabled", { id, enabled });
}

export async function checkExtensionUpdates(config) {
  return call(config, "plugins.checkUpdates");
}

export async function updateExtension(config, id) {
  return call(config, "plugins.update", { id });
}

export async function updateAllExtensions(config) {
  return call(config, "plugins.updateAll");
}
