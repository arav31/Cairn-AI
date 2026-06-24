import React from "react";
import {AbsoluteFill, Sequence} from "remotion";
import {scenes} from "./storyboard";
import {SceneShell} from "./components/SceneShell";
import {
  BrowserLoop,
  ColdOpen,
  Conclusion,
  RecordOnce,
  Reliability,
  RepetitionCost,
  ShowcaseScene,
  TypedApi,
} from "./SceneViews";

export type CairnExplainerProps = {
  showcaseVideoAvailable?: boolean;
};

export const CairnExplainer = ({showcaseVideoAvailable = false}: CairnExplainerProps) => (
  <AbsoluteFill>
    {scenes.map((scene) => {
      const content = (() => {
        switch (scene.id) {
          case "cold-open":
            return <ColdOpen scene={scene} />;
          case "browser-loop":
            return <BrowserLoop scene={scene} />;
          case "repetition-cost":
            return <RepetitionCost scene={scene} />;
          case "record-once":
            return <RecordOnce scene={scene} />;
          case "typed-api":
            return <TypedApi scene={scene} />;
          case "showcase":
            return (
              <ShowcaseScene
                scene={scene}
                showcaseVideoAvailable={showcaseVideoAvailable}
              />
            );
          case "reliability":
            return <Reliability scene={scene} />;
          case "conclusion":
            return <Conclusion scene={scene} />;
          default:
            return null;
        }
      })();

      return (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          durationInFrames={scene.durationInFrames}
          premountFor={30}
        >
          <SceneShell
            scene={scene}
            imageAlign={scene.id === "repetition-cost" ? "left" : "right"}
            dark={scene.id === "showcase"}
          >
            {content}
          </SceneShell>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
