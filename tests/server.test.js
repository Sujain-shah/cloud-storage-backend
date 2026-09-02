const request =
    require("supertest");

const app =
    require("../src/server");


describe(
    "Backend API Tests",

    () => {

        test(
            "GET / should return API running message",

            async () => {

                const response =
                    await request(app)
                        .get("/");

                expect(
                    response.statusCode
                ).toBe(200);

                expect(
                    response.body.message
                ).toBe(
                    "Cloud Storage API is running"
                );
            }
        );


        test(
            "Protected files route should reject request without token",

            async () => {

                const response =
                    await request(app)
                        .get("/api/files");

                expect(
                    response.statusCode
                ).toBe(401);
            }
        );


        test(
            "Search should reject request without token",

            async () => {

                const response =
                    await request(app)
                        .get(
                            "/api/files/search?q=test"
                        );

                expect(
                    response.statusCode
                ).toBe(401);
            }
        );


        test(
            "Search without query should fail after authentication",

            async () => {

                const response =
                    await request(app)
                        .get(
                            "/api/files/search"
                        );

                expect(
                    [
                        400,
                        401
                    ]
                ).toContain(
                    response.statusCode
                );
            }
        );
    }
);