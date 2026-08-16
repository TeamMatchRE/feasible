import "server-only";
import { accessTokenFor } from "@/lib/google-oauth";

/**
 * GOOGLE DRIVE — read the folders, file things back into them.
 *
 * Raw fetch against Drive v3 rather than the `googleapis` package, matching how
 * the rest of this app talks to remote services (parcels.ts, flood.ts,
 * wetlands.ts). The package is large, and three endpoints do not justify it.
 *
 * Everything here acts AS THE SIGNED-IN USER (see google-oauth.ts), so the app
 * can only ever see what that person can already see — including the Heritage
 * Point folders that live in their "Shared with me" and are owned by Nick.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  owner: string | null;
};

export type DriveResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; needsReconnect?: boolean };

/**
 * Pull a folder id out of whatever the user pasted.
 *
 * People paste the browser URL, the "share" URL, or occasionally the bare id.
 * Accepting all three removes a step that would otherwise fail confusingly.
 */
export function parseFolderId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /^([a-zA-Z0-9_-]{10,})$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,iconLink,owners(displayName)";

type RawFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  owners?: { displayName?: string }[];
};

const shape = (f: RawFile): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  isFolder: f.mimeType === FOLDER_MIME,
  size: f.size ? Number(f.size) : null,
  modifiedTime: f.modifiedTime ?? null,
  webViewLink: f.webViewLink ?? null,
  iconLink: f.iconLink ?? null,
  owner: f.owners?.[0]?.displayName ?? null,
});

async function call<T>(
  profileId: string,
  url: string,
  init?: RequestInit,
): Promise<DriveResult<T>> {
  const tok = await accessTokenFor(profileId);
  if (!tok.ok) return { ok: false, error: tok.error, needsReconnect: tok.needsReconnect };

  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${tok.token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();

    // 404 on Drive usually means "you can't see it", not "it doesn't exist" —
    // saying so saves a long hunt for a folder that was simply never shared.
    if (res.status === 404) {
      return { ok: false, error: "Not found, or not shared with your Google account." };
    }

    // Google's own 403 message is better than anything we could write: for a
    // disabled API it names the project AND gives the one-click enable URL.
    // Guessing at the cause here would replace an actionable link with a hunch.
    const googleMessage = (() => {
      try {
        const j = JSON.parse(body) as { error?: { message?: string } };
        return j.error?.message ?? null;
      } catch {
        return null;
      }
    })();

    if (res.status === 403) {
      return {
        ok: false,
        error:
          googleMessage ??
          "Google refused the request — the Drive API may not be enabled on the OAuth project.",
      };
    }
    return { ok: false, error: googleMessage ?? `Drive returned ${res.status}. ${body.slice(0, 200)}` };
  }
  return { ok: true, data: (await res.json()) as T };
}

/** One folder's metadata — used to confirm a pasted link resolves before saving it. */
export async function getFile(profileId: string, fileId: string): Promise<DriveResult<DriveFile>> {
  const r = await call<RawFile>(
    profileId,
    `${API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`,
  );
  return r.ok ? { ok: true, data: shape(r.data) } : r;
}

/**
 * Contents of a folder, folders first.
 *
 * `includeItemsFromAllDrives` + `supportsAllDrives` are both required for shared
 * drives; without them a folder that plainly exists in the web UI comes back
 * empty, which reads as a permissions bug and isn't one.
 */
export async function listFolder(
  profileId: string,
  folderId: string,
): Promise<DriveResult<DriveFile[]>> {
  const q = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: `files(${FIELDS})`,
    orderBy: "folder,name",
    pageSize: "200",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  const r = await call<{ files: RawFile[] }>(profileId, `${API}/files?${params.toString()}`);
  return r.ok ? { ok: true, data: (r.data.files ?? []).map(shape) } : r;
}

/** Find a direct child folder by name — how "…/Equity Raise/Stern" is resolved. */
export async function findChildFolder(
  profileId: string,
  parentId: string,
  name: string,
): Promise<DriveResult<DriveFile | null>> {
  const escaped = name.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: `files(${FIELDS})`,
    pageSize: "5",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  const r = await call<{ files: RawFile[] }>(profileId, `${API}/files?${params.toString()}`);
  if (!r.ok) return r;
  const f = r.data.files?.[0];
  return { ok: true, data: f ? shape(f) : null };
}

/**
 * Upload a file into a folder — how a signed commitment gets filed.
 *
 * Multipart rather than resumable: these are scans and PDFs, comfortably inside
 * the 5MB simple-upload ceiling, and resumable would add a round trip and a
 * session to manage for no benefit at this size.
 */
export async function uploadFile(
  profileId: string,
  folderId: string,
  file: { name: string; mimeType: string; bytes: Uint8Array },
): Promise<DriveResult<DriveFile>> {
  const tok = await accessTokenFor(profileId);
  if (!tok.ok) return { ok: false, error: tok.error, needsReconnect: tok.needsReconnect };

  const boundary = `feasible-${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: file.name, parents: [folderId] });

  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(tail);

  const body = new Uint8Array(headBytes.length + file.bytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(file.bytes, headBytes.length);
  body.set(tailBytes, headBytes.length + file.bytes.length);

  const res = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Upload failed (${res.status}). ${text.slice(0, 200)}` };
  }
  return { ok: true, data: shape((await res.json()) as RawFile) };
}

/** Create a folder — used to scaffold a per-investor folder that doesn't exist yet. */
export async function createFolder(
  profileId: string,
  parentId: string,
  name: string,
): Promise<DriveResult<DriveFile>> {
  const r = await call<RawFile>(
    profileId,
    `${API}/files?supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    },
  );
  return r.ok ? { ok: true, data: shape(r.data) } : r;
}

export const prettySize = (bytes: number | null): string => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ---------------------------------------------------------------------------
// Reading a document's CONTENT
// ---------------------------------------------------------------------------

/**
 * Google-native files (Docs, Sheets) have no bytes to download — they must be
 * EXPORTED to a concrete format. Sheets export to CSV, Docs to plain text.
 *
 * ⚠️ A Sheets CSV export returns the FIRST TAB ONLY. That is a real limit, not
 * an oversight: pulling every tab needs the Sheets API, which is a separate API
 * to enable and a separate scope. Callers should say so rather than implying the
 * whole workbook was read.
 */
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_DOC = "application/vnd.google-apps.document";

export function exportMimeFor(mimeType: string): string | null {
  if (mimeType === GOOGLE_SHEET) return "text/csv";
  if (mimeType === GOOGLE_DOC) return "text/plain";
  return null;
}

/** True for things worth sending to a model: text-ish, or a PDF. */
export function isReadable(mimeType: string): boolean {
  return (
    exportMimeFor(mimeType) != null ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/")
  );
}

/** Text of a Google-native file, or of a plain text file. */
export async function readTextFile(
  profileId: string,
  fileId: string,
  mimeType: string,
): Promise<DriveResult<string>> {
  const tok = await accessTokenFor(profileId);
  if (!tok.ok) return { ok: false, error: tok.error, needsReconnect: tok.needsReconnect };

  const exportMime = exportMimeFor(mimeType);
  const url = exportMime
    ? `${API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `${API}/files/${fileId}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` }, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Couldn't read that file (${res.status}). ${body.slice(0, 160)}` };
  }
  return { ok: true, data: await res.text() };
}

/** Raw bytes — used for PDFs, which go to the model as a document block. */
export async function readBinaryFile(
  profileId: string,
  fileId: string,
): Promise<DriveResult<{ base64: string; bytes: number }>> {
  const tok = await accessTokenFor(profileId);
  if (!tok.ok) return { ok: false, error: tok.error, needsReconnect: tok.needsReconnect };

  const res = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${tok.token}` },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, error: `Couldn't download that file (${res.status}).` };

  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, data: { base64: buf.toString("base64"), bytes: buf.length } };
}
