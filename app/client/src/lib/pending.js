/** Where a link pasted before sign-up waits until there's a brain to put it in. */
export const PENDING_LINK = 'sb:pending-link';

export function takePendingLink() {
  const link = sessionStorage.getItem(PENDING_LINK);
  if (link) sessionStorage.removeItem(PENDING_LINK);
  return link;
}
