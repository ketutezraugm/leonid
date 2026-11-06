import type { Model } from '@bryntum/gantt';
import { BryntumGantt } from '@bryntum/gantt-react';
import { memo } from 'react';
import '@bryntum/gantt/fontawesome/css/fontawesome.css';
import '@bryntum/gantt/fontawesome/css/solid.css';
import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/svalbard-light.css';
import './gantt-theme.css';
import { demoDependencies, demoTasks, EVENT_DAY } from './demoPlan';
import { gateBySponsor, statusText, type PlanSponsor } from './gating';
import { PlanTask } from './PlanTask';

// Loaded lazily from the Plan page: the trial bundle is large and unminified. The page remounts it
// (by key) when a sponsor's status changes, so the gating is recomputed from scratch.
function PlanGantt({ sponsors }: { sponsors: PlanSponsor[] }) {
  return (
    <div className="qm-gantt">
      <BryntumGantt
        project={{
          taskModelClass: PlanTask,
          tasks: gateBySponsor(demoTasks, sponsors),
          dependencies: demoDependencies,
          timeRanges: [{ id: 'event-day', name: 'Event day', startDate: EVENT_DAY }],
        }}
        startDate="2027-01-04"
        endDate="2027-03-28"
        viewPreset={{ base: 'weekAndMonth', tickWidth: 46 }}
        columns={[
          { type: 'name', width: 270 },
          {
            text: 'Status',
            field: 'status',
            width: 190,
            renderer: ({ record }: { record: Model }) => {
              const task = record as PlanTask;
              return {
                tag: 'span',
                className: `badge badge-${task.status}`,
                text: statusText(task.status, task.waitingOn),
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
            wrapperCls.add(`qm-status-${(taskRecord as PlanTask).status}`);
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
const sameStatuses = (a: { sponsors: PlanSponsor[] }, b: { sponsors: PlanSponsor[] }) =>
  a.sponsors.length === b.sponsors.length &&
  a.sponsors.every((s, i) => s.id === b.sponsors[i]?.id && s.status === b.sponsors[i]?.status);

export default memo(PlanGantt, sameStatuses);
