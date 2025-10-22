// this used to be a really nice template
// but it got blocked by mail servers
// i think my emails still get captured by microsoft quarantine :(
export const makeVerificationEmail = (link: string) =>
	`<p>Thanks for your interest in HammerWars 2025! <a href="${link}" >Click here to verify your email.</a> If you encounter any issues, don't hesitate to contact us on <a href="https://discord.gg/A6twkCcW83" >Discord</a>.<br/> - <a href="https://purduecpu.com" >Purdue Competitive Programmers Union</a></p>

  <p>If you didn't initiate this request, you can ignore this email.</p>`;
