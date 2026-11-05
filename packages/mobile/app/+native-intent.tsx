import { rewriteWebPathForApp } from '@festie/shared/utils';

// Web-only public paths open the closest mobile screen (see rewriteWebPathForApp).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteWebPathForApp(path) ?? path;
}
