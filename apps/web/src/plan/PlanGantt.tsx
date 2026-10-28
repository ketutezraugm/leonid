import { BryntumGantt } from '@bryntum/gantt-react';
import '@bryntum/gantt/fontawesome/css/fontawesome.css';
import '@bryntum/gantt/fontawesome/css/solid.css';
import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/svalbard-light.css';
import './gantt-theme.css';
import { demoDependencies, demoTasks, EVENT_DAY } from './demoPlan';
import { PlanTask } from './PlanTask';

// Loaded lazily from the Plan page: the trial bundle is large and unminified.
export default function PlanGantt() {
  return (
    <div className="qm-gantt">
      <BryntumGantt
        project={{
          taskModelClass: PlanTask,
          tasks: demoTasks,
          dependencies: demoDependencies,
          timeRanges: [{ id: 'event-day', name: 'Event day', startDate: EVENT_DAY }],
        }}
        startDate="2027-01-04"
        endDate="2027-03-28"
        viewPreset={{ base: 'weekAndMonth', tickWidth: 46 }}
        columns={[
          { type: 'name', width: 250 },
          { type: 'startdate', width: 110 },
          { type: 'duration', width: 80 },
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
