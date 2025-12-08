// import './App.css';

// const App = () => {
//   return (
//     <div className="content">
//       <h1>Rsbuild with React</h1>
//       <p>Start building amazing things with Rsbuild.</p>
//     </div>
//   );
// };

// export default App;
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview';
import { useEffect, useState } from 'react';
import { BreakpointChip, usePanelBreakpoint } from './PanelBreakpoint';

const Default = (props: IDockviewPanelProps) => {
  const { panelRef, panelWidth, currentBreakpoint, chipVisible } =
    usePanelBreakpoint();

  return (
    <div ref={panelRef} style={{ height: '100%', position: 'relative' }}>
      <BreakpointChip
        width={panelWidth}
        breakpoint={currentBreakpoint}
        visible={chipVisible}
      />
      <div>{props.api.title}</div>
    </div>
  );
};

const components = {
  default: Default,
};

const Component = (props: { theme?: string }) => {
  const [disablePanelDrag, setDisablePanelDrag] = useState<boolean>(false);
  const [disableGroupDrag, setDisableGroupDrag] = useState<boolean>(false);
  const [disableOverlay, setDisableOverlay] = useState<boolean>(false);

  const [api, setApi] = useState<DockviewApi>();

  useEffect(() => {
    if (!api) {
      return;
    }

    const disposables = [
      api.onWillDragPanel((e) => {
        if (!disablePanelDrag) {
          return;
        }
        e.nativeEvent.preventDefault();
      }),

      api.onWillDragGroup((e) => {
        if (!disableGroupDrag) {
          return;
        }
        e.nativeEvent.preventDefault();
      }),
      api.onWillShowOverlay((e) => {
        console.log(e);

        if (!disableOverlay) {
          return;
        }

        e.preventDefault();
      }),

      api.onWillDrop(() => {
        console.log('onwilldrop');
        //
      }),

      api.onDidDrop(() => {
        console.log('ondiddrop');

        //
      }),
    ];

    return () => {
      disposables.forEach((disposable) => {
        disposable.dispose();
      });
    };
  }, [api, disablePanelDrag, disableGroupDrag, disableOverlay]);

  const onReady = (event: DockviewReadyEvent) => {
    setApi(event.api);

    event.api.addPanel({
      id: 'panel_1',
      component: 'default',
    });

    event.api.addPanel({
      id: 'panel_2',
      component: 'default',
      position: {
        direction: 'right',
        referencePanel: 'panel_1',
      },
    });

    event.api.addPanel({
      id: 'panel_3',
      component: 'default',
      position: {
        direction: 'below',
        referencePanel: 'panel_1',
      },
    });
    event.api.addPanel({
      id: 'panel_4',
      component: 'default',
    });
    event.api.addPanel({
      id: 'panel_5',
      component: 'default',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div>
        <button
          type="button"
          onClick={() => setDisablePanelDrag(!disablePanelDrag)}
        >{`Panel Drag: ${disablePanelDrag ? 'disabled' : 'enabled'}`}</button>
        <button
          type="button"
          onClick={() => setDisableGroupDrag(!disableGroupDrag)}
        >{`Group Drag: ${disableGroupDrag ? 'disabled' : 'enabled'}`}</button>
        <button
          type="button"
          onClick={() => setDisableOverlay(!disableOverlay)}
        >{`Overlay: ${disableOverlay ? 'disabled' : 'enabled'}`}</button>
      </div>
      <div style={{ flexGrow: 1 }}>
        <DockviewReact
          className={`${props.theme || 'dockview-theme-abyss'}`}
          onReady={onReady}
          components={components}
        />
      </div>
    </div>
  );
};

export default Component;
