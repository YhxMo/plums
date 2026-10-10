export interface TestProjectPlan {
  name: string;
  group?: string;
  include: string[];
  maxWorkers?: number;
  groupOrder?: number;
  setupFiles?: string[];
}
export const testPlan: { projects: TestProjectPlan[]; required: unknown[] };
export const groups: Record<string, string[]>;
export const requiredTests: unknown[];
