(function () {
    // All spot-the-difference assets and coordinates are managed here only.
    const FOCUS_LEVELS = [
        {
            id: "prototype-01",
            difficulty: "easy",
            enabled: true,
            image: "/static/images/games/spot-the-diff/img_0001.jpg",
            differences: [
                { id: "diff-1", shape: "circle", x: 2444, y: 1828, r: 120 },
                { id: "diff-2", shape: "circle", x: 2173, y: 450, r: 120 },
                { id: "diff-3", shape: "circle", x: 3628, y: 1108, r: 100 },
            ],
        },
        {
            id: "medium-placeholder-01",
            difficulty: "medium",
            enabled: true,
            image: "/static/images/games/spot-the-diff/img_0002.jpg",
            differences: [
                { id: "diff-1", shape: "circle", x: 1898, y: 168, r: 150 },
                { id: "diff-2", shape: "circle", x: 2281, y: 786, r: 80 },
                { id: "diff-3", shape: "circle", x: 2854, y: 844, r: 80 },
                { id: "diff-4", shape: "circle", x: 2886, y: 1247, r: 80 },
                { id: "diff-5", shape: "circle", x: 1707, y: 849, r: 80 },
            ],
        },
        {
            id: "hard-placeholder-01",
            difficulty: "hard",
            enabled: true,
            image: "/static/images/games/spot-the-diff/img_0003.jpg",
            differences: [
                { id: "diff-1", shape: "circle", x: 1723, y: 589, r: 80 },
                { id: "diff-2", shape: "circle", x: 2227, y: 610, r: 80 },
                { id: "diff-3", shape: "circle", x: 1956, y: 102, r: 80 },
                { id: "diff-4", shape: "circle", x: 2706, y: 343, r: 80 },
                { id: "diff-5", shape: "circle", x: 2361, y: 886, r: 150 },
                { id: "diff-6", shape: "circle", x: 2568, y: 884, r: 60 },
                { id: "diff-7", shape: "circle", x: 2663, y: 940, r: 60 },
                { id: "diff-8", shape: "circle", x: 1933, y: 986, r: 200 },
            ],
        },
    ];

    window.FOCUS_LEVELS = FOCUS_LEVELS;
})();
