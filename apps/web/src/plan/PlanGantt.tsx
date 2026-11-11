import type { Model } from '@bryntum/core-thin';
import { BryntumGantt } from '@bryntum/gantt-react-thin';
import { memo } from 'react';
// The thin Gantt registers only the features it imports itself; the event-day line below needs the scheduler's TimeRanges.
import '@bryntum/scheduler-thin/lib/feature/TimeRanges.js';
import '@bryntum/core-thin/fontawesome/css/fontawesome.css';
import '@bryntum/core-thin/fontawesome/css/solid.css';
import '@bryntum/core-thin/core.css';
import '@bryntum/grid-thin/grid.css';
import '@bryntum/scheduler-thin/scheduler.css';
import '@bryntum/schedulerpro-thin/schedulerpro.css';
import '@bryntum/gantt-thin/gantt.css';
import '@bryntum/core-thin/svalbard-light.css';
import './gantt-theme.css';
import type { PlanSource } from './fromApi';
import { applySponsors, fundingText, statusLabel, type PlanSponsor } from './gating';
import { PlanTask } from './PlanTask';

// Loaded lazily from the Plan page: the trial bundle is large and unminified. The page remounts it
// (by key) when a sponsor's status changes, so the sponsor labels are recomputed from scratch.
function PlanGantt({ plan, sponsors }: { plan: PlanSource; sponsors: PlanSponsor[] }) {
  return (
    <div className="lx-gantt">
      <BryntumGantt
        project={{
          taskModelClass: PlanTask,
          tasks: applySponsors(plan.tasks, sponsors),
          dependencies: plan.dependencies,
          timeRanges: [{ id: 'event-day', name: 'Event day', startDate: plan.eventDay }],
        }}
        startDate={plan.startDate}
        endDate={plan.endDate}
        viewPreset={{ base: 'weekAndMonth', tickWidth: 46 }}
        columns={[
          { type: 'name', width: 270 },
          {
            text: 'Status',
            field: 'status',
            width: 120,
            renderer: ({ record }: { record: Model }) => {
              const task = record as PlanTask;
              return {
                tag: 'span',
                className: `badge badge-${task.status}`,
                text: statusLabel[task.status],
              };
            },
          },
          {
            text: 'Funded by',
            field: 'fundedBy',
            width: 200,
            renderer: ({ record }: { record: Model }) => {
              const task = record as PlanTask;
              return {
                tag: 'span',
                className: 'lx-funding',
                text: fundingText(task.fundedBy, task.fundedByPaid),
              };
            },
          },
          { type: 'startdate', width: 124 },
          { type: 'duration', width: 90 },
        ]}
        // A task's `cls` lands on its grid row, so the status class goes on the bar's wrapper here.
        taskRenderer={({ taskRecord, renderData }) => {
          const { wrapperCls } = renderData;
          if (typeof wrapperCls !== 'string') {
            wrapperCls.add(`lx-status-${(taskRecord as PlanTask).status}`);
          }
          return '';
        }}
        indicatorsFeature
        timeRangesFeature
        // Event day is the line that matters; the generic project start/end lines just add noise.
        projectLinesFeature={false}
        criticalPathsFeature={false}
      />
    </div>
  );
}

// The Plan page re-renders while it polls sponsor status; the Gantt only redraws when a sponsor's status changes.
const sameStatuses = (
  a: { plan: PlanSource; sponsors: PlanSponsor[] },
  b: { plan: PlanSource; sponsors: PlanSponsor[] },
) =>
  a.plan === b.plan &&
  a.sponsors.length === b.sponsors.length &&
  a.sponsors.every((s, i) => s.id === b.sponsors[i]?.id && s.status === b.sponsors[i]?.status);

export default memo(PlanGantt, sameStatuses);
