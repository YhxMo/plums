/**
 * The person using the app, at the top of the rail: a blank plum (outline,
 * stem and leaf, no face) in neutral greys. Only a picture for now; the
 * shared-memory extension will make it the entry to what all Agents know.
 */
export function UserAvatar() {
  return (
    <svg
      data-slot="user-avatar"
      aria-hidden="true"
      viewBox="0 0 36 36"
      className="size-9 shrink-0 rounded-full"
    >
      <circle data-part="tile" cx="18" cy="18" r="18" className="fill-user" />
      <circle
        data-part="body"
        cx="18"
        cy="21"
        r="9.5"
        className="fill-user-ink"
      />
      <path
        data-part="stem"
        d="M18 11.6c0-2.4.7-3.8 1.7-4.8"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="fill-none stroke-user-ink"
      />
      <path
        data-part="leaf"
        d="M19.4 9.2c1.7-2.4 4.8-3.1 6.8-2.4-.7 2.4-3.8 3.8-6.8 2.4z"
        className="fill-user-ink"
      />
    </svg>
  );
}
