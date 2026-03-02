const OWNER_EMAILS = new Set([
  "patshahid23@gmail.com",
]);

export const isOwnerEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return OWNER_EMAILS.has(email.trim().toLowerCase());
};
