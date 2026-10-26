export const MEDIA_ELEMENT_LEAD_SECONDS = 1e-5;

export function mediaElementTime(sourceSeconds: number): number {
  return sourceSeconds + MEDIA_ELEMENT_LEAD_SECONDS;
}
