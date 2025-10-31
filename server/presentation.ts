import { ContestProperties, PresentationState } from "../shared/util";
import { Mutable, propertiesChanged } from "./db";
import { domJudge } from "./domjudge";

async function getPresentationState(
	prop: ContestProperties["presentation"],
): Promise<PresentationState> {
	if (prop == null) {
		return { type: "none" };
	}

	if (prop.type == "submission") {
		const subs = await domJudge.getPreFreezeSolutions();
	}
}

class Presentation {
	state = new Mutable<PresentationState>({ type: "none" });
	async #loop() {
		while (true) {
			try {
				const change = await propertiesChanged.waitFor(x => x.k == "presentation");
				if (change?.k == "presentation") this.state.v = await getPresentationState(change.v);
			} catch (e) {
				console.error("presentation error", e);
			}
		}
	}
	start() {
		void this.#loop();
	}
}

export const presentation = new Presentation();
presentation.start();
