// Nav icons for the sidebar, open or collapsed to its rail. One stroke style, drawn on a 24px grid, no brand marks.
const paths: Record<string, string> = {
  home: 'M4 11l8-6.5 8 6.5M6 10v9h12v-9',
  events: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  agent: 'M5 4.5h14a2 2 0 012 2V15a2 2 0 01-2 2h-6.5L8 20.5V17H5a2 2 0 01-2-2V6.5a2 2 0 012-2zM8 9h8M8 12.5h5',
  plan: 'M4 7h9M4 12h14M4 17h7M15 5v4M19 15v4',
  money: 'M5 6h14v12H5zM5 10h14M9 14h3',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2',
  approvals: 'M5 12.5l4.5 4.5L19 7.5',
  claims: 'M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4',
  sidebarOpen: 'M4 5h16v14H4zM9 5v14M13 9.5l2.5 2.5-2.5 2.5',
  sidebarClose: 'M4 5h16v14H4zM9 5v14M15.5 9.5L13 12l2.5 2.5',
  user: 'M12 4a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM5 20c0-3.6 3.1-6 7-6s7 2.4 7 6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  eyeOff: 'M3 3l18 18M10.3 6a9 9 0 011.7-.5C18 5.5 21.5 12 21.5 12a16 16 0 01-2.7 3.5M6.5 7.6A16 16 0 002.5 12S6 18.5 12 18.5a9 9 0 003.6-.8M9.9 9.9a2.5 2.5 0 003.2 3.2',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
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
