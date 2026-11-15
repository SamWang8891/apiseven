import { createContext, useContext } from 'react';

/** Whether a TooltipProvider is above: the kit's icon-only Button shows its label as a tooltip only then. */
export const TooltipsProvided = createContext(false);

export const useTooltipsAvailable = (): boolean => useContext(TooltipsProvided);
