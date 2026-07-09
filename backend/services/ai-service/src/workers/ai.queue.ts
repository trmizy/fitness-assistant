import { Queue } from 'bullmq';

export const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
} as const;

let aiQueueInstance: Queue | null = null;

export function getAiQueue(): Queue {
  if (!aiQueueInstance) {
    aiQueueInstance = new Queue('ai-tasks', { connection: redisConnection });
  }
  return aiQueueInstance;
}

export async function closeAiQueue(): Promise<void> {
  if (!aiQueueInstance) return;
  const queue = aiQueueInstance;
  aiQueueInstance = null;
  await queue.close();
}

export const aiQueue = new Proxy({} as Queue, {
  get(_target, property, receiver) {
    const queue = getAiQueue();
    const value = Reflect.get(queue, property, receiver);
    return typeof value === 'function' ? value.bind(queue) : value;
  },
});
