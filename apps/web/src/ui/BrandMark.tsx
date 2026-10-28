// The Quartermaster mark: a brass hexagon, the system's one piece of insignia.
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8l8-5 8 5v8l-8 5-8-5z" fill="currentColor" />
      <path d="M8 10.5l4-2.5 4 2.5v3l-4 2.5-4-2.5z" fill="var(--color-bg)" />
    </svg>
  );
}
