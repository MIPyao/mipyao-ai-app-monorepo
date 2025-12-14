import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// cn 辅助函数用于合并 Tailwind CSS 类名
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
