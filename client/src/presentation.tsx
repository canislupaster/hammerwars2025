import { Pattern3, PatternBg } from "./home";

export default function Presentation() {
	return <div>
		<PatternBg pat={() => new Pattern3()} uniformVelocity flipAnim velocity={0.5} />
	</div>;
}
