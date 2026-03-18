import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useTutorials, TutorialOverlay } from "@/components/interactive-tutorial";

type TutorialContextType = ReturnType<typeof useTutorials>;

const TutorialContext = createContext<TutorialContextType | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const tutorials = useTutorials();
  const { activeTutorial, currentStep, setCurrentStep, stopTutorial, completeTutorial, saveProgress } = tutorials;
  const totalSteps = activeTutorial?.steps.length || 0;
  const prevStepRef = useRef(currentStep);

  useEffect(() => {
    if (activeTutorial && currentStep !== prevStepRef.current) {
      prevStepRef.current = currentStep;
      saveProgress(activeTutorial.id, currentStep, false);
    }
  }, [activeTutorial, currentStep, saveProgress]);

  return (
    <TutorialContext.Provider value={tutorials}>
      {children}
      <TutorialOverlay
        tutorial={activeTutorial}
        currentStep={currentStep}
        totalSteps={totalSteps}
        onNext={() => {
          if (currentStep < totalSteps - 1) {
            setCurrentStep(currentStep + 1);
          }
        }}
        onPrev={() => {
          if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
          }
        }}
        onSkip={stopTutorial}
        onComplete={() => {
          if (activeTutorial) {
            completeTutorial(activeTutorial.id);
          }
        }}
      />
    </TutorialContext.Provider>
  );
}

export function useTutorialContext() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorialContext must be used inside TutorialProvider");
  return ctx;
}
