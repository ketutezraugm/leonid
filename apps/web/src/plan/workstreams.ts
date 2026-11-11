import { Workstream, type TaskKind } from '@leonid/shared';

// The plan's workstreams in the order the legend lists them, with the words the organizer reads. Each one's colour is the
// --color-ws-<workstream> token (underscores as dashes), applied in home/calendar-theme.css.
export const WORKSTREAMS = Workstream.options;

export const WORKSTREAM_LABEL: Record<Workstream, string> = {
  venue: 'Venue',
  catering: 'Catering',
  swag: 'Swag',
  av: 'AV and wifi',
  printing: 'Printing and signage',
  photo_video: 'Photo and video',
  prizes: 'Prizes',
  people: 'Speakers and volunteers',
  sponsors: 'Sponsors',
};

/** The class suffix and token suffix for a workstream: "photo_video" -> "photo-video"; no workstream -> "none". */
export const workstreamSlug = (ws: Workstream | null) => (ws ?? 'none').replace('_', '-');

// What the calendar puts before a task's name: a diamond for a milestone, a dollar sign for a payment.
export const KIND_ICON: Record<TaskKind, string | null> = {
  milestone: 'fa-diamond',
  payment: 'fa-dollar-sign',
  task: null,
};
