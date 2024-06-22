import { Tw2GeometryBatch } from "../batch";
import { meta, assignIfExists } from "utils";
import { Tw2Effect } from "./Tw2Effect";


@meta.type("Tw2MeshArea", "Tr2MeshArea")
@meta.stage(1)
export class Tw2MeshArea extends meta.Model
{

    @meta.string
    name = "";

    @meta.boolean
    display = true;

    @meta.uint
    count = 1;

    @meta.struct("Tw2Effect")
    effect = null;

    @meta.uint
    index = 0;

    @meta.notImplemented
    @meta.boolean
    reversed = false;

    @meta.notImplemented
    @meta.boolean
    useSHLighting = false;

    @meta.uint
    meshIndex = 0;

    // CCPWGL2 only
    @meta.plain
    @meta.isPrivate
    _sofMeta = null;

    /**
     * Gets a mesh areas's resources
     * @param {Array} out
     * @returns {Array<Tw2Resource>} out
     */
    GetResources(out = [])
    {
        return this.effect ? this.effect.GetResources(out) : out;
    }

    /**
     * Finds an effect parameter by it's name
     * @param {String} name
     * @returns {Tw2Parameter|null}
     */
    FindParameter(name)
    {
        return this.effect ? this.effect.FindParameter(name) : null;
    }

    /**
     * Creates a mesh area from a plain object
     * @param {*} [values]
     * @param {*} [options]
     * @returns {Tw2MeshArea}
     */
    static from(values, options)
    {
        const item = new this();

        // Why is this here?
        if (options) assignIfExists(item, options, "index");

        if (values)
        {
            assignIfExists(item, values, [
                "name", "display", "count", "index", "reversed", "useSHLighting"
            ]);

            if (values.effect)
            {
                if (values.effect instanceof Tw2Effect)
                {
                    item.effect = values.effect;
                }
                else
                {
                    item.effect = Tw2Effect.from(values.effect);
                }
            }
        }

        return item;
    }


    /**
     * Render Batch Constructor
     * @type {Tw2RenderBatch}
     */
    static batchType = Tw2GeometryBatch;

}
