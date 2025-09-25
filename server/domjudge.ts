import createClient, { ClientMethod } from "openapi-fetch";
import type { paths } from "./domjudge-api";



{
		Authorization: `Basic ${
			Buffer.from(`${process.env["DOMJUDGE_API_USER"]}:${process.env["DOMJUDGE_API_KEY"]}`)
				.toString("base64")
		}`,
	}

const { data, error } = await client.GET("/api/v4/contests/{cid}/event-feed", {
	params: { path: { cid: "" } },
});

if (error) throw new Error("ugh");
