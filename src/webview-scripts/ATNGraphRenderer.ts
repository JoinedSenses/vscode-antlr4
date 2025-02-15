/*
 * This file is released under the MIT license.
 * Copyright (c) 2018, 2020, Mike Lischke
 *
 * See LICENSE file for more info.
 */

import { D3DragEvent, SimulationLinkDatum, SimulationNodeDatum } from "d3";
import { IATNGraphData, IATNNode, IATNGraphLayoutNode, IATNLink, IATNGraphLayoutLink } from "./types";

const stateType = [
    {  // Pretend that this state type is a rule. It's normally the INVALID state type.
        short: "RULE",
        long: "Rule call\nThis is not a real ATN state but a placeholder to indicate a sub rule being 'called' by " +
            "the rule transition.",
    },
    { short: "BASIC", long: "Basic state" },
    { short: "START", long: "Rule start\nThe entry node of a rule." },
    { short: "BSTART", long: "Block start state\nThe start of a regular (...) block." },
    { short: "PBSTART", long: "Plus block start state\nStart of the actual block in a (A|b|...)+ loop." },
    { short: "SBSTART", long: "Star block start\nStart of the actual block in a (A|b|...)* loop." },
    { short: "TSTART", long: "Token start\nThe entry state of a rule." },
    { short: "STOP", long: "Rule stop\nThe exit state of a rule." },
    { short: "BEND", long: "Block end\nTerminal node of a simple (A|b|...) block." },
    { short: "SLBACK", long: "Star loop back\nThe loop back state from the inner block to the star loop entry state." },
    { short: "SLENTRY", long: "Star loop entry\nEntry + exit state for (A|B|...)* loops." },
    {
        short: "PLBACK",
        long: "Plus loop back\nThe loop back state from the inner block to the plus block start state.",
    },
    { short: "LEND", long: "Loop end\nMarks the end of a * or + loop." },
];

/* eslint-disable @typescript-eslint/naming-convention */

// This enum is a copy of the declaration in antlr4ts. It's here to avoid having to import it.
// Pure types disappear when this file is transpiled to JS. Not this type though (enums become vars and importing
// them results in a wrong import statement in the transpiled file).
enum ATNStateType {
    INVALID_TYPE = 0,
    BASIC = 1,
    RULE_START = 2,
    BLOCK_START = 3,
    PLUS_BLOCK_START = 4,
    STAR_BLOCK_START = 5,
    TOKEN_START = 6,
    RULE_STOP = 7,
    BLOCK_END = 8,
    STAR_LOOP_BACK = 9,
    STAR_LOOP_ENTRY = 10,
    PLUS_LOOP_BACK = 11,
    LOOP_END = 12
}

const ATNRuleType = ATNStateType.INVALID_TYPE;

/* eslint-enable @typescript-eslint/naming-convention */

interface IATNGraphRendererData {
    objectName: string;
    maxLabelCount: number;
    data: IATNGraphData;
    initialScale: number;
    initialTranslation: { x?: number; y?: number };
}

interface ILine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

type ATNNodeSelection = d3.Selection<SVGElement, IATNGraphLayoutNode, SVGElement, IATNGraphData>;
type ATNLinkSelection = d3.Selection<SVGLineElement, IATNLink, SVGElement, IATNGraphData>;
type ATNTextSelection = d3.Selection<SVGTextElement, IATNNode, SVGGElement, IATNGraphData>;
type ATNLinkTextSelection = d3.Selection<SVGTextElement, IATNGraphLayoutLink, SVGGElement, IATNGraphData>;

type ATNGraphDragEvent = D3DragEvent<SVGElement, IATNGraphData, IATNGraphLayoutNode>;

export class ATNGraphRenderer {

    private static readonly gridSize = 20;

    private svg: d3.Selection<SVGElement, IATNGraphData, HTMLElement, unknown>;
    private topGroup: d3.Selection<SVGElement, IATNGraphData, HTMLElement, unknown>;

    private zoom: d3.ZoomBehavior<SVGElement, IATNGraphData>;
    private figures: ATNNodeSelection;
    private lines: ATNLinkSelection;
    private text: ATNTextSelection;
    private descriptions: ATNTextSelection;
    private linkLabels: ATNLinkTextSelection;
    private simulation: d3.Simulation<IATNGraphLayoutNode, undefined>;

    public constructor(private data: IATNGraphRendererData) { }

    /**
     * This getter is used to return the current transformation details for caching.
     *
     * @returns The current ZoomTransform, with the values x, y, and k (for translation and scaling).
     */
    public get currentTransformation(): object {
        return d3.zoomTransform(this.topGroup.node()!);
    }

    public get nodes(): IATNGraphLayoutNode[] {
        return this.data.data.nodes;
    }

    public render(): void {
        const nodes = this.data.data.nodes as IATNGraphLayoutNode[];
        const links = this.data.data.links;

        this.svg = d3.select<SVGElement, IATNGraphData>("svg")
            .attr("xmlns", "http://www.w3.org/2000/svg")
            .attr("version", "1.1")
            .attr("width", "100%"); // Height is determined by the flex layout.

        this.topGroup = this.svg.append("g");

        this.zoom = d3.zoom<SVGElement, IATNGraphData>()
            .scaleExtent([0.15, 3])
            .on("zoom", (e: d3.D3ZoomEvent<SVGElement, IATNGraphData>) => {
                this.topGroup.attr("transform", e.transform.toString());
            });

        this.resetTransformation();

        // Drawing primitives.
        this.lines = this.topGroup.append("g").selectAll<SVGElement, SimulationLinkDatum<IATNGraphLayoutNode>>("line")
            .data(links)
            .enter().append("line")
            .attr("class", "transition")
            .attr("marker-end", (link) => {
                if (nodes[link.target].type === ATNRuleType) {
                    return "url(#transitionEndRect)";
                }

                return "url(#transitionEndCircle)";
            });

        const group = this.topGroup.append<SVGElement>("g");
        for (const figure of nodes) {
            let element;

            let cssClass = "state " + stateType[figure.type].short;
            const recursive = figure.name === this.data.objectName;
            if (recursive) {
                cssClass += " recursive";
            }

            if (figure.type === ATNRuleType) {
                element = group.append<SVGElement>("rect")
                    .attr("width", 50) // Size and offset are updated below, depending on label size.
                    .attr("height", 50)
                    .attr("y", -25)
                    .attr("rx", 5)
                    .attr("ry", recursive ? 20 : 5)
                    .attr("class", cssClass)
                    .on("dblclick", this.doubleClicked)
                    .call(d3.drag()
                        .on("start", this.dragStarted)
                        .on("drag", this.dragged),
                    );
            } else {
                element = group.append<SVGElement>("circle")
                    .attr("r", 30)
                    .attr("class", cssClass)
                    .on("dblclick", this.doubleClicked)
                    .call(d3.drag()
                        .on("start", this.dragStarted)
                        .on("drag", this.dragged),
                    );
            }

            // Add a tooltip to each element.
            element.append("title").text(stateType[figure.type].long);
        }

        this.figures = group.selectAll<SVGElement, IATNGraphLayoutNode>(".state").data(nodes);

        this.text = this.topGroup.append("g").selectAll("text")
            .data(nodes)
            .enter().append("text")
            .attr("x", 0)
            .attr("y", 0)
            .attr("class", "stateLabel")
            .text((d) => {
                return d.name;
            });

        // Go through all rect elements and resize/offset them according to their label sizes.
        const textNodes = this.text.nodes();
        const rectNodes = this.figures.nodes();

        const border = 20;
        for (let i = 0; i < textNodes.length; ++i) {
            if (nodes[i].type === ATNRuleType) {
                const element = textNodes[i];
                let width = Math.ceil(element.getComputedTextLength());
                if (width < 70) {
                    width = 70;
                }
                width += border;
                const rect = rectNodes[i];
                rect.setAttribute("width", `${width}px`);
                rect.setAttribute("x", `${-width / 2}px`);

                nodes[i].width = width;
            }
        }

        this.descriptions = this.topGroup.append("g").selectAll("description")
            .data(nodes)
            .enter().append("text")
            .attr("x", 0)
            .attr("y", 13)
            .attr("class", "stateTypeLabel")
            .text((node) => {
                return stateType[node.type].short;
            });

        this.linkLabels = this.topGroup.append("g").selectAll("labels")
            .data(links)
            .enter().append("text")
            .attr("x", 0)
            .attr("y", 0)
            .attr("class", "linkLabel")
            .call(this.appendLinkText);

        this.simulation = d3.forceSimulation(nodes)
            .force("charge", d3.forceManyBody().strength(-400))
            .force("collide", d3.forceCollide(100).strength(0.5).iterations(3))
            .force("link", d3.forceLink(links)
                .distance(200)
                .strength(2))
            .on("tick", this.animationTick)
            .on("end", this.animationEnd);

        // The simulation automatically starts, but we want to have it first do some iterations before
        // showing the initial layout. Makes for a much better initial display.
        this.simulation.stop();

        // Do a number of iterations without visual update, which is usually very fast (much faster than animating
        // each step).
        this.simulation.tick(100);

        // Now do the initial visual update.
        this.animationTick();
    }

    public resetTransformation = (): void => {
        const xTranslate = this.data.initialTranslation.x ?? (this.svg.node()?.clientWidth ?? 0) / 2;
        const yTranslate = this.data.initialTranslation.y ?? (this.svg.node()?.clientHeight ?? 0) / 2;
        this.svg.call(this.zoom)
            // eslint-disable-next-line @typescript-eslint/unbound-method
            .call(this.zoom.transform, d3.zoomIdentity
                .scale(this.data.initialScale)
                .translate(xTranslate, yTranslate))
            .on("dblclick.zoom", null);

        this.resetNodePositions();
    };

    private resetNodePositions(): void {
        const nodes = this.data.data.nodes as IATNGraphLayoutNode[];

        // Mark start and end nodes as vertically fixed if not already done by the caller.
        // Because of the (initial) zoom translation the origin of the SVG is in the center.
        for (const node of nodes) {
            node.fx = null;
            node.fy = null;
            if (node.type === ATNStateType.RULE_START) {
                if (node.x === undefined) {
                    // Note: this is not the fixed x position, but the initial x position.
                    node.x = -1000;
                }

                if (!node.fy) {
                    node.fy = 0;
                }
            } else if (node.type === ATNStateType.RULE_STOP) {
                // No initial x position for the end node. For unknown reasons this makes it appear left to the
                // start node.
                if (!node.fy) {
                    node.fy = 0;
                }
            }
        }
    }

    /**
     * Splits link label text into multiple tspan entries and adds them to the link elements.
     *
     * @param links The link elements to process.
     */
    private appendLinkText = (links: ATNLinkTextSelection): void => {
        links.each((link, index, list) => {
            let lineNumber = 0;
            const element = d3.select(list[index]);
            for (const label of link.labels) {
                ++lineNumber;
                const span = element.append("tspan")
                    .attr("x", 0)
                    .attr("dy", "1.5em")
                    .text(label.content);

                if (label.class) {
                    span.classed(label.class, true);
                }

                if (lineNumber === this.data.maxLabelCount) {
                    const remainingCount = link.labels.length - this.data.maxLabelCount;
                    if (remainingCount > 0) {
                        element.append("tspan")
                            .attr("x", 0)
                            .attr("dy", "1.5em")
                            .text(`${link.labels.length - this.data.maxLabelCount} more ...`);
                    }

                    break;
                }
            }
        });
    };

    private animationTick = (): void => {
        this.figures.attr("transform", this.transform);
        this.text.attr("transform", this.transform);
        this.descriptions.attr("transform", this.transform);

        this.transformLines();
        this.transformLinkLabels();
    };

    private animationEnd = (): void => {
        this.figures.attr("transform", this.snapTransform);
        this.text.attr("transform", this.snapTransform);
        this.descriptions.attr("transform", this.snapTransform);

        this.transformLines();
        this.transformLinkLabels();
    };

    private transform = (node: IATNGraphLayoutNode) => {
        return `translate(${node.x ?? 0},${node.y ?? 0})`;
    };

    private snapTransform = (node: IATNGraphLayoutNode) => {
        return `translate(${this.snapToGrid(node.x ?? 0)},${this.snapToGrid(node.y ?? 0)})`;
    };

    /**
     * For links that end at a rule node we have to compute the end position such that we
     * end up on the border of the node rectangle (otherwise the end marker would be hidden).
     * For other nodes we can use a static marker offset (as defined in the svg defs section).
     *
     * @param horizontal Indicates if the computation is done for x values or y values.
     * @param element The link for which to compute the end coordinate.
     *
     * @returns The computed coordinate(either for x or y).
     */
    private endCoordinate(horizontal: boolean, element: IATNLink): number {
        if (this.isATNLayoutNode(element.source) && this.isATNLayoutNode(element.target)) {
            if (element.target.type === ATNRuleType) {
                const sourceX = element.source.x ?? 0;
                const sourceY = element.source.y ?? 0;

                const targetX = element.target.x ?? 0;
                const targetY = element.target.y ?? 0;
                const targetWidth = element.target.width ?? 0;

                const line1 = {
                    x1: sourceX,
                    y1: sourceY,
                    x2: targetX,
                    y2: targetY,
                };

                let line2 = {
                    x1: targetX - targetWidth / 2,
                    y1: targetY - 25,
                    x2: targetX + targetWidth / 2,
                    y2: targetY - 25,
                };

                let intersection = this.lineIntersection(line1, line2);
                if (intersection) {
                    return horizontal ? intersection.x : intersection.y;
                }

                line2 = {
                    x1: targetX - targetWidth / 2,
                    y1: targetY + 25,
                    x2: targetX + targetWidth / 2,
                    y2: targetY + 25,
                };

                intersection = this.lineIntersection(line1, line2);
                if (intersection) {
                    return horizontal ? intersection.x : intersection.y;
                }

                line2 = {
                    x1: targetX - targetWidth / 2,
                    y1: targetY - 25,
                    x2: targetX - targetWidth / 2,
                    y2: targetY + 25,
                };

                intersection = this.lineIntersection(line1, line2);
                if (intersection) {
                    return horizontal ? intersection.x : intersection.y;
                }

                line2 = {
                    x1: targetX + targetWidth / 2,
                    y1: targetY - 25,
                    x2: targetX + targetWidth / 2,
                    y2: targetY + 25,
                };

                intersection = this.lineIntersection(line1, line2);
                if (intersection) {
                    return horizontal ? intersection.x : intersection.y;
                }
            }

            // For circle nodes or when the center of the source node is within the bounds of the target node rect.
            return (horizontal ? element.target.x : element.target.y) ?? 0;
        }

        return 0;
    }

    /**
     * Computes the point where two lines intersect each other.
     *
     * @param line1 The first line.
     * @param line2 The second line.
     *
     * @returns an object with the computed coordinates or undefined, if the lines are parallel.
     */
    private lineIntersection(line1: ILine, line2: ILine): { x: number; y: number } | undefined {
        const s1X = line1.x2 - line1.x1;
        const s1Y = line1.y2 - line1.y1;
        const s2X = line2.x2 - line2.x1;
        const s2Y = line2.y2 - line2.y1;

        const s = (-s1Y * (line1.x1 - line2.x1) + s1X * (line1.y1 - line2.y1)) / (-s2X * s1Y + s1X * s2Y);
        const t = (s2X * (line1.y1 - line2.y1) - s2Y * (line1.x1 - line2.x1)) / (-s2X * s1Y + s1X * s2Y);

        if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
            return {
                x: line1.x1 + (t * s1X),
                y: line1.y1 + (t * s1Y),
            };
        }
    }

    private transformLinkLabels(): void {
        this.linkLabels
            .attr("transform", (link) => {
                // We have to compute the slope of the label and its position.
                // For the first we need the center coordinates of the figures, while positioning depends on the size
                // of the figures.
                const targetY = this.isSimulationNodeDatum(link.target) ? link.target.y ?? 0 : 0;
                const sourceY = this.isSimulationNodeDatum(link.source) ? link.source.y ?? 0 : 0;

                // For rule figures we computed a width value before, which we can use here to adjust the
                // horizontal coordinates to account for different rule name lengths.
                let sourceX = 0;
                if (this.isSimulationNodeDatum(link.source)) {
                    sourceX = link.source.x ?? 0;
                }

                let targetX = 0;
                if (this.isSimulationNodeDatum(link.target)) {
                    targetX = link.target.x ?? 0;
                }

                const slope = Math.atan2((targetY - sourceY), (targetX - sourceX)) * 180 / Math.PI;

                // Now that have the slope, update the available horizontal range.
                if (this.isSimulationNodeDatum(link.source)) {
                    if (link.source.width) {
                        sourceX += link.source.width / 2;
                    } else {
                        sourceX += 25; // The circle radius + border.
                    }
                }

                if (this.isSimulationNodeDatum(link.target)) {
                    if (link.target.width) {
                        targetX -= link.target.width / 2;
                    } else {
                        targetX -= 25; // The circle radius + border.
                    }
                }

                let xOffset = 0;
                let yOffset = 0;
                let effectiveSlope = 0;

                switch (true) {
                    case (slope > -45 && slope < 45): {
                        effectiveSlope = slope;
                        break;
                    }

                    case (slope < -135 || slope > 135): {
                        effectiveSlope = slope + 180;
                        xOffset = 10;
                        break;
                    }

                    case (slope >= 45 || slope <= -45): {
                        xOffset = 10;
                        yOffset = -10;
                        break;
                    }

                    default:
                }

                return `translate(${(targetX + sourceX) / 2}, ${(targetY + sourceY) / 2}) rotate(${effectiveSlope}) ` +
                    `translate(${xOffset}, ${yOffset})`;
            });
    }

    private transformLines(): void {
        this.lines
            .attr("x1", (link) => {
                if (this.isATNLayoutNode(link.source)) {
                    return link.source.x ?? 0;
                }

                return 0;
            })
            .attr("y1", (link) => {
                if (this.isATNLayoutNode(link.source)) {
                    return link.source.y ?? 0;
                }

                return 0;
            })
            .attr("x2", (link) => {
                if (this.isATNLayoutNode(link.target)) {
                    link.target.endX = this.endCoordinate(true, link);

                    return link.target.endX;
                }

                return 0;
            })
            .attr("y2", (link) => {
                if (this.isATNLayoutNode(link.target)) {
                    link.target.endY = this.endCoordinate(false, link);

                    return link.target.endY;
                }

                return 0;
            });
    }

    private dragStarted = (e: ATNGraphDragEvent) => {
        if (!e.active) {
            this.simulation.alphaTarget(0.3).restart();
        }

        e.subject.fx = e.x;
        e.subject.fy = e.y;
    };

    private dragged = (e: ATNGraphDragEvent) => {
        e.subject.fx = this.snapToGrid(e.x);
        e.subject.fy = this.snapToGrid(e.y);
    };

    private doubleClicked = (_event: MouseEvent, data: unknown) => {
        const node = data as IATNGraphLayoutNode;
        node.fx = undefined;
        node.fy = undefined;
    };

    private snapToGrid(value: number): number {
        return Math.round(value / ATNGraphRenderer.gridSize) * ATNGraphRenderer.gridSize;
    }

    private isATNLayoutNode(node: string | number | IATNGraphLayoutNode): node is IATNGraphLayoutNode {
        return (typeof node !== "string") && (typeof node !== "number");
    }

    private isSimulationNodeDatum(node: string | number | d3.SimulationNodeDatum): node is SimulationNodeDatum {
        return (typeof node !== "string") && (typeof node !== "number");
    }
}
