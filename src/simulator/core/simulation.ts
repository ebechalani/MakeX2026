/**
 * The one function the rest of the app uses to run a match:
 *
 *   const sim = createSimulation({ game, scenario, robotConfig, program });
 *   sim.start();
 *   sim.step(100);        // one simulated second
 *   sim.score();
 *
 * It simply joins the two halves of the simulator: the physics + sensor engine (./engine.ts)
 * and the interpreter that runs the student's blocks (../vm).
 */
import { createVM } from '../vm';
import { createEngineSimulation } from './engine';
import type { Simulation, SimulationOptions } from './types';

export function createSimulation<S>(opts: SimulationOptions<S>): Simulation<S> {
  return createEngineSimulation(opts, createVM);
}
