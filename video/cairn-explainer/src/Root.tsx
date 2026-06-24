import React from "react";
import {Composition} from "remotion";
import {CairnExplainer, type CairnExplainerProps} from "./CairnExplainer";
import {showcaseVideoAvailable} from "./showcaseManifest";
import {COMPOSITION} from "./storyboard";

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION.id}
    component={CairnExplainer}
    durationInFrames={COMPOSITION.durationInFrames}
    fps={COMPOSITION.fps}
    width={COMPOSITION.width}
    height={COMPOSITION.height}
    defaultProps={{showcaseVideoAvailable} satisfies CairnExplainerProps}
  />
);
