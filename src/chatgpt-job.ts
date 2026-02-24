import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const JOBS_DIR = path.join(os.homedir(), '.copilot', 'jobs');

export interface ChatGPTJob {
  id: string;
  createdAt: string;

  prompt: string;
  promptLength: number;

  cdpHost: string;
  cdpPort: number;
  extensionId: string;
  pageUrl: string;

  status: 'dispatched' | 'watching' | 'completed' | 'error';
  watcherPid?: number;
  lastHeartbeat?: string;

  response?: string;
  responseLength?: number;
  completedAt?: string;
  error?: string;
}

export function generateJobId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

export function jobFilePath(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

function ensureJobsDir(): void {
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

/** Atomic write: write to .tmp then rename to prevent partial reads */
function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export function writeJob(job: ChatGPTJob): void {
  ensureJobsDir();
  atomicWrite(jobFilePath(job.id), JSON.stringify(job, null, 2));
}

export function readJob(id: string): ChatGPTJob | null {
  try {
    const fp = jobFilePath(id);
    if (!fs.existsSync(fp)) return null;
    const data = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(data) as ChatGPTJob;
  } catch {
    return null;
  }
}

export function updateJobStatus(id: string, updates: Partial<ChatGPTJob>): void {
  const job = readJob(id);
  if (!job) return;
  Object.assign(job, updates);
  atomicWrite(jobFilePath(id), JSON.stringify(job, null, 2));
}

export function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  try {
    if (!fs.existsSync(JOBS_DIR)) return;
    const now = Date.now();
    for (const file of fs.readdirSync(JOBS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const fp = path.join(JOBS_DIR, file);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fp);
        }
      } catch {
        // ignore per-file errors
      }
    }
  } catch {
    // ignore cleanup errors entirely
  }
}
