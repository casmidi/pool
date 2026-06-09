/**
 * Optional Redis cache client using the Redis RESP protocol directly.
 * No npm dependency is required; when Redis is unavailable callers fall back
 * to the existing memory/file cache.
 */

import net from "net";
import tls from "tls";
import { URL } from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";

let client = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "..", "user-config.json");

function getRedisUrl(opts = {}) {
  if (opts.redisUrl || process.env.REDIS_URL) return opts.redisUrl || process.env.REDIS_URL;
  try {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
    return cfg.redisUrl || null;
  } catch {
    return null;
  }
}

function encodeCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    chunks.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return chunks.join("");
}

function readLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  return { line: buffer.toString("utf8", offset, end), offset: end + 2 };
}

function parseOne(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const first = readLine(buffer, offset + 1);
  if (!first) return null;

  if (type === "+") return { value: first.line, offset: first.offset };
  if (type === "-") throw new Error(first.line);
  if (type === ":") return { value: Number(first.line), offset: first.offset };
  if (type === "$") {
    const length = Number(first.line);
    if (length < 0) return { value: null, offset: first.offset };
    const end = first.offset + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString("utf8", first.offset, end), offset: end + 2 };
  }
  if (type === "*") {
    const count = Number(first.line);
    if (count < 0) return { value: null, offset: first.offset };
    const values = [];
    let nextOffset = first.offset;
    for (let i = 0; i < count; i++) {
      const parsed = parseOne(buffer, nextOffset);
      if (!parsed) return null;
      values.push(parsed.value);
      nextOffset = parsed.offset;
    }
    return { value: values, offset: nextOffset };
  }
  throw new Error("Unsupported Redis response");
}

class RedisClient {
  constructor(redisUrl) {
    this.url = new URL(redisUrl);
    this.socket = null;
    this.queue = [];
    this.buffer = Buffer.alloc(0);
    this.ready = false;
    this.disabledUntil = 0;
  }

  async connect() {
    if (this.socket && this.ready) return;
    if (Date.now() < this.disabledUntil) throw new Error("Redis temporarily disabled");

    const port = Number(this.url.port || 6379);
    const host = this.url.hostname;
    const socketFactory = this.url.protocol === "rediss:" ? tls.connect : net.connect;

    this.socket = socketFactory({ host, port });
    this.socket.setTimeout(2500);
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("timeout", () => this.onError(new Error("Redis timeout")));
    this.socket.on("close", () => {
      this.ready = false;
      this.socket = null;
    });

    await new Promise((resolve, reject) => {
      const fail = (err) => reject(err);
      this.socket.once("connect", resolve);
      this.socket.once("error", fail);
    });

    this.ready = true;

    if (this.url.password) {
      await this.command(["AUTH", decodeURIComponent(this.url.password)]);
    }

    const db = this.url.pathname?.replace("/", "");
    if (db) await this.command(["SELECT", db]);
  }

  onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.queue.length) {
      let parsed;
      try {
        parsed = parseOne(this.buffer);
      } catch (err) {
        const item = this.queue.shift();
        item.reject(err);
        this.buffer = Buffer.alloc(0);
        continue;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.offset);
      const item = this.queue.shift();
      item.resolve(parsed.value);
    }
  }

  onError(err) {
    this.ready = false;
    this.disabledUntil = Date.now() + 30_000;
    while (this.queue.length) {
      this.queue.shift().reject(err);
    }
    try {
      this.socket?.destroy();
    } catch { /* ignore */ }
    this.socket = null;
  }

  async command(parts) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.socket.write(encodeCommand(parts));
    });
  }
}

function getClient(opts = {}) {
  const redisUrl = getRedisUrl(opts);
  if (!redisUrl) return null;
  if (!client || client.url.href !== new URL(redisUrl).href) {
    client = new RedisClient(redisUrl);
  }
  return client;
}

function fullKey(namespace, key, opts = {}) {
  const prefix = opts.prefix || process.env.REDIS_PREFIX || "meridian";
  return `${prefix}:${namespace}:${key}`;
}

export function redisEnabled(opts = {}) {
  return !!getRedisUrl(opts);
}

export async function redisGetJson(key, opts = {}) {
  const c = getClient(opts);
  if (!c) return null;
  const namespace = opts.namespace || "default";
  try {
    const raw = await c.command(["GET", fullKey(namespace, key, opts)]);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    log("cache", `Redis get fallback [${namespace}:${key}]: ${err.message}`);
    return null;
  }
}

export async function redisSetJson(key, value, opts = {}) {
  const c = getClient(opts);
  if (!c) return false;
  const namespace = opts.namespace || "default";
  const ttlSeconds = Math.max(1, Math.ceil(Number(opts.ttlMs || 300_000) / 1000));
  try {
    await c.command([
      "SETEX",
      fullKey(namespace, key, opts),
      ttlSeconds,
      JSON.stringify(value),
    ]);
    return true;
  } catch (err) {
    log("cache", `Redis set fallback [${namespace}:${key}]: ${err.message}`);
    return false;
  }
}

export async function redisDel(pattern, opts = {}) {
  const c = getClient(opts);
  if (!c) return false;
  const namespace = opts.namespace || "default";
  try {
    const key = fullKey(namespace, pattern.replace(/\*$/, ""), opts);
    if (!pattern.endsWith("*")) {
      await c.command(["DEL", fullKey(namespace, pattern, opts)]);
      return true;
    }
    const keys = await c.command(["KEYS", `${key}*`]);
    if (Array.isArray(keys) && keys.length) await c.command(["DEL", ...keys]);
    return true;
  } catch {
    return false;
  }
}
