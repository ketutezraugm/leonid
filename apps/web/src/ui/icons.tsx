// Nav icons for the collapsed rail (Plan and Money). One stroke style, drawn on a 24px grid, no brand marks.
const paths: Record<string, string> = {
  home: 'M4 11l8-6.5 8 6.5M6 10v9h12v-9',
  agent: 'M5 4.5h14a2 2 0 012 2V15a2 2 0 01-2 2h-6.5L8 20.5V17H5a2 2 0 01-2-2V6.5a2 2 0 012-2zM8 9h8M8 12.5h5',
  plan: 'M4 7h9M4 12h14M4 17h7M15 5v4M19 15v4',
  money: 'M5 6h14v12H5zM5 10h14M9 14h3',
  approvals: 'M5 12.5l4.5 4.5L19 7.5',
  rules: 'M6 4h12v16H6zM9 9h6M9 13h6M9 17h3',
  claims: 'M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
};

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
