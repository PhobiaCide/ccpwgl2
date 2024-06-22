import { meta } from "utils";
import { resMan, device } from "global";
import { box3, sph3, vec3, vertex } from "math";
import { Tw2BinaryReader, WBGReader, CAKEReader, OBJReader, GR2JsonReader } from "../reader";
import { Tw2VertexElement } from "../vertex";
import { ErrResourceFormatUnsupported, Tw2Resource } from "./Tw2Resource";
import { Tw2Error } from "../Tw2Error";

import {
    Tw2GeometryAnimation,
    Tw2GeometryCurve,
    Tw2GeometryMesh,
    Tw2GeometryMeshArea,
    Tw2GeometryMeshBinding,
    Tw2GeometryModel,
} from "../geometry";


// Todo: Change to registration process
const readers = {
    [OBJReader.extension.toLowerCase()]: OBJReader,
    [CAKEReader.extension.toLowerCase()]: CAKEReader,
    [GR2JsonReader.extension.toLowerCase()]: GR2JsonReader,
    [WBGReader.extension.toLowerCase()]: WBGReader
};

/**
 * Geometry resource
 *
 * @inheritDoc {Tw2Resource}
 * @property {Array<Tw2GeometryMesh>} meshes
 * @property {vec3} minBounds
 * @property {vec3} maxBounds
 * @property {vec3} boundsSpherePosition
 * @property {Number} boundsSphereRadius
 * @property {Array<Tw2GeometryModel>} models
 * @property {Array<Tw2GeometryAnimation>} animations
 * @property {Boolean} _boundsDirty
 */
@meta.type("Tw2GeometryRes", "TriGeometryRes")
export class Tw2GeometryRes extends Tw2Resource
{

    meshes = [];
    minBounds = vec3.fromValues(0, 0, 0);
    maxBounds = vec3.fromValues(0, 0, 0);
    boundsSpherePosition = vec3.create();
    boundsSphereRadius = 0;
    models = [];
    animations = [];

    _isCustom = false;
    _requiresSystemMirror = false;
    _requestResponseType = null;
    _extension = null;
    _boundsDirty = true;

    /**
     * Sets system mirror
     * @param {Boolean} enable
     * @returns {Promise<Boolean>} true if the resource was reloaded
     */
    async SetSystemMirror(enable)
    {
        let reloadRequired = false;

        for (let i = 0; i < this.meshes.length; i++)
        {
            if (!this.meshes[i].HasSystemMirror() && enable || this.meshes[i].IsSystemMirrorRequired())
            {
                reloadRequired = true;
                break;
            }
        }

        if (reloadRequired)
        {
            if (this._custom)
            {
                this.UpdateFromJSON(this._custom.factory(this._custom.options));
            }
            else
            {
                await new Promise((onResolved, onRejected) =>
                {
                    this.RegisterCallbacks(onResolved, onRejected);
                    resMan.LoadResource(this, {
                        name: "System Mirror",
                        message: "Rebuilding system mirror"
                    });
                });
            }
        }

        if (!enable)
        {
            this.ClearSystemMirrorIfNotRequired();
        }

        return reloadRequired;
    }

    /**
     * Forces system mirror
     * @param {Boolean} bool
     * @returns {Promise<boolean>} true if resource was reloaded
     */
    async ForceSystemMirror(bool)
    {
        this._requiresSystemMirror = !!bool;
        return this.SetSystemMirror(bool);
    }

    /**
     * Clears system mirror if not required
     */
    ClearSystemMirrorIfNotRequired()
    {
        if (!this._requiresSystemMirror && !this._isCustom)
        {
            for (let i = 0; i < this.meshes.length; i++)
            {
                this.meshes[i].ClearSystemMirrorIfNotRequired();
            }
        }
    }

    /**
     * Does an intersection test on the geometry resource
     * @param {Tw2RayCaster} ray
     * @param {Array} intersects
     * @param {mat4} worldTransform
     * @param {Object} [cache={}]
     * @param {Number} meshIndex
     * @returns {Array}
     */
    Intersect(ray, intersects, worldTransform, cache = {}, meshIndex = 0)
    {
        //console.log("Intersecting geometry resource: " + this.path);

        this.RebuildBounds();
        const intersect = ray.IntersectBounds(this.minBounds, this.maxBounds, worldTransform);
        if (!intersect) return [];

        const internalIntersects = [];

        const mesh = this.meshes[meshIndex];
        if (mesh)
        {
            mesh.Intersect(ray, intersects, worldTransform, cache)
                .forEach(intersect =>
                {
                    intersect.geometryResource = this;
                    intersect.meshIndex = meshIndex;
                    intersect.mesh = mesh;
                    internalIntersects.push(intersect);
                });
        }

        return internalIntersects.sort(ray._sortFunction);
    }

    /**
     * Rebuilds bounds
     */
    RebuildBounds(force)
    {
        if (!this._boundsDirty && !force)
        {
            for (let i = 0; i < this.meshes.length; i++)
            {
                if (this.meshes[i]._boundsDirty)
                {
                    this._boundsDirty = true;
                    break;
                }
            }
        }

        if (this._boundsDirty || force)
        {
            const
                min = this.minBounds,
                max = this.maxBounds;

            box3.bounds.empty(min, max);
            for (let i = 0; i < this.meshes.length; i++)
            {
                const mesh = this.meshes[i];
                mesh.RebuildBounds(force);
                box3.bounds.union(min, max, min, max, mesh.minBounds, mesh.maxBounds);
            }

            this.boundsSphereRadius = box3.bounds.toPositionRadius(min, max, this.boundsSpherePosition);
            this._boundsDirty = false;
        }
    }

    /**
     * Gets bounding box
     * @param {box3} out
     * @param {boolean} force
     * @return {null|box3}
     */
    GetBoundingBox(out, force)
    {
        this.RebuildBounds(force);
        return box3.fromBounds(out, this.minBounds, this.maxBounds);
    }

    /**
     * Gets bounding sphere
     * @param {sph3} out
     * @param {boolean} force
     * @return {null|sph3}
     */
    GetBoundingSphere(out, force)
    {
        this.RebuildBounds(force);
        return sph3.fromPositionRadius(out, this.boundsSpherePosition, this.boundsSphereRadius);
    }


    /**
     * GetInstanceBuffer
     * @param {Number} meshIndex
     * @returns {*}
     */
    GetInstanceBuffer(meshIndex)
    {
        return meshIndex < this.meshes.length ? this.meshes[meshIndex].buffer : undefined;
    }

    /**
     * GetInstanceDeclaration
     * @param {Number} meshIndex
     * @returns {Tw2VertexDeclaration}
     */
    GetInstanceDeclaration(meshIndex)
    {
        return this.meshes[meshIndex].declaration;
    }

    /**
     * GetInstanceStride
     * @param {Number} meshIndex
     * @returns {Number}
     */
    GetInstanceStride(meshIndex)
    {
        return this.meshes[meshIndex].declaration.stride;
    }

    /**
     * GetInstanceCount
     * @param {Number} meshIndex
     * @returns {Number}
     */
    GetInstanceCount(meshIndex)
    {
        return this.meshes[meshIndex].bufferLength * 4 / this.meshes[meshIndex].declaration.stride;
    }

    /**
     * Handles different geometry formats
     * @param {String} url
     * @param {String} extension
     */
    DoCustomLoad(url, extension)
    {
        this._extension = null;
        this._requestResponseType = null;

        const reader = readers[extension.toLowerCase()];
        if (!reader) throw new ErrResourceFormatUnsupported({ format: extension });

        this._extension = extension;
        this._requestResponseType = reader.requestResponseType;
    }

    /**
     * Clears the geometry data
     */
    Clear()
    {
        for (let i = 0; i < this.meshes.length; i++) this.meshes[i].Clear();
        this.meshes.splice(0);
        this.models.splice(0);
        this.animations.splice(0);
        vec3.set(this.minBounds, 0, 0, 0);
        vec3.set(this.maxBounds, 0, 0, 0);
        vec3.set(this.boundsSpherePosition, 0, 0, 0);
        this.boundsSphereRadius = 0;
    }

    /**
     * Prepares the object
     * TODO: Normalize geometry readers
     * @param {*} data
     * @param {Object} [options]
     */
    Prepare(data, options)
    {
        this.Clear();

        const Reader = readers[this._extension];
        if (!Reader) throw new ErrResourceFormatUnsupported({ format: this._extension });

        // TODO: Remove this option
        if (Reader.byMesh)
        {
            this.PrepareFromMeshes(Reader.construct(data));
        }
        else
        {
            Reader.Prepare(data, this, options);
        }

        this.RebuildBounds();
        this._custom = null;

        if (!resMan.IsSystemMirrorEnabled()) this.ClearSystemMirrorIfNotRequired();
        this.OnPrepared();
    }

    /**
     * Prepares custom formats
     * @param {Array<Object>}meshes
     */
    PrepareFromMeshes(meshes)
    {
        const gl = device.gl;

        for (let i = 0; i < meshes.length; i++)
        {
            const { bufferData, indexData, declaration, areas, name = `${this.path}_model_${i}` } = meshes[i];

            const mesh = new Tw2GeometryMesh();
            this.meshes[i] = mesh;

            mesh.name = name;
            mesh.declaration = declaration;

            mesh.bufferLength = bufferData.length;
            mesh.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.STATIC_DRAW);

            mesh.indexes = gl.createBuffer();
            mesh.indexType = indexData.BYTES_PER_ELEMENT === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexes);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

            for (let i = 0; i < areas.length; ++i)
            {
                const { name, start, count } = areas[i];
                const area = new Tw2GeometryMeshArea();
                area.name = name;
                area.start = start;
                area.count = count;
                mesh.areas.push(area);
            }

            mesh.RecalculateAreaBounds(bufferData, indexData);

            mesh._areas = areas.length;
            mesh._faces = indexData.length / 3;
            mesh._vertices = bufferData.length / (mesh.declaration.stride / 4);
            mesh.bufferData = bufferData;
            mesh.indexData = indexData;

            // Temporary
            this.models[i] = new Tw2GeometryModel();
        }
    }

    /**
     * BindMeshToModel
     * @param {Tw2GeometryMesh} mesh
     * @param {Tw2GeometryModel} model
     * @param {Tw2GeometryRes} res
     */
    static BindMeshToModel(mesh, model, res)
    {
        const binding = new Tw2GeometryMeshBinding();
        binding.mesh = mesh;
        for (let b = 0; b < binding.mesh.boneBindings.length; ++b)
        {
            const
                name = binding.mesh.boneBindings[b],
                bone = model.FindBoneByName(name);

            if (!bone)
            {
                throw new ErrGeometryMeshBoneNameInvalid({
                    path: res.path,
                    mesh: binding.mesh.name,
                    bone: name,
                    model: model.name
                });
            }
            else
            {
                binding.bones.push(bone);
                bone.boundingBox = mesh.FindBoneBoundsByName(name);
            }
        }
        model.meshBindings.push(binding);
    }

    /**
     * RenderAreasInstanced
     * @param {Number} meshIx
     * @param {Number} start
     * @param {Number} count
     * @param {Tw2Effect} effect
     * @param {String} technique
     * @param instanceVB
     * @param {Tw2VertexDeclaration} instanceDecl
     * @param {Number} instanceStride
     * @param {Number} instanceCount
     * @returns {Boolean}
     */
    RenderAreasInstanced(meshIx, start, count, effect, technique = effect.defaultTechnique, instanceVB, instanceDecl, instanceStride, instanceCount)
    {
        this.KeepAlive();
        const passCount = effect.GetPassCount(technique);
        if (!passCount || !this.IsGood() || meshIx >= this.meshes.length) return false;

        const
            d = device,
            gl = d.gl,
            mesh = this.meshes[meshIx];

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexes);

        for (let pass = 0; pass < passCount; ++pass)
        {
            effect.ApplyPass(technique, pass);
            const passInput = effect.GetPassInput(technique, pass);
            if (passInput.elements.length === 0) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
            mesh.declaration.SetPartialDeclaration(d, passInput, mesh.declaration.stride);

            gl.bindBuffer(gl.ARRAY_BUFFER, instanceVB);
            const resetData = instanceDecl.SetPartialDeclaration(d, passInput, instanceStride, 0, 1);

            d.ApplyShadowState();

            for (let i = 0; i < count; ++i)
            {
                if (i + start < mesh.areas.length)
                {
                    let area = mesh.areas[i + start],
                        areaStart = area.start,
                        areaCount = area.count;

                    while (i + 1 < count)
                    {
                        area = mesh.areas[i + 1 + start];

                        if (!area)
                        {
                            this.OnError(new ErrGeometryMeshAreaMissing({
                                path: this.path,
                                areaIndex: i + 1 + start
                            }));
                            return false;
                        }

                        if (area.start !== areaStart + areaCount * 2) break;
                        areaCount += area.count;
                        ++i;
                    }
                    gl.drawElementsInstanced(gl.TRIANGLES, areaCount, mesh.indexType, areaStart, instanceCount);
                }
            }
            instanceDecl.ResetInstanceDivisors(d, resetData);
        }
        return true;
    }

    /**
     * RenderAreas
     * @param {Number} meshIx
     * @param {Number} start
     * @param {Number} count
     * @param {Tw2Effect} effect
     * @param {String} technique
     * @returns {Boolean}
     */
    RenderAreas(meshIx, start, count, effect, technique = effect.defaultTechnique)
    {
        this.KeepAlive();
        const passCount = effect.GetPassCount(technique);
        if (!passCount || !this.IsGood() || meshIx >= this.meshes.length) return false;

        const
            d = device,
            gl = d.gl,
            mesh = this.meshes[meshIx] || this.meshes[0];

        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexes);

        for (let pass = 0; pass < passCount; ++pass)
        {
            effect.ApplyPass(technique, pass);
            const passInput = effect.GetPassInput(technique, pass);
            if (!mesh.declaration.SetDeclaration(d, passInput, mesh.declaration.stride))
            {
                this.OnError(new ErrGeometryMeshEffectBinding({
                    path: this.path,
                    pass: pass,
                    passInput: passInput,
                    meshStride: mesh.declaration.stride
                }));
                return false;
            }

            d.ApplyShadowState();

            for (let i = 0; i < count; ++i)
            {
                if (i + start < mesh.areas.length)
                {
                    let area = mesh.areas[i + start],
                        areaStart = area.start,
                        areaCount = area.count;

                    while (i + 1 < count)
                    {
                        area = mesh.areas[i + 1 + start];

                        if (!area)
                        {
                            this.OnError(new ErrGeometryMeshAreaMissing({
                                path: this.path,
                                areaIndex: i + 1 + start
                            }));
                            return false;
                        }

                        if (area.start !== areaStart + areaCount * 2) break;
                        areaCount += area.count;
                        ++i;
                    }
                    gl.drawElements(gl.TRIANGLES, areaCount, mesh.indexType, areaStart);
                }
            }
        }
        return true;
    }

    /**
     * RenderLines
     * @param {Number} meshIx
     * @param {Number} start
     * @param {Number} count
     * @param {Tw2Effect} effect
     * @param {String} technique
     * @returns {Boolean}
     */
    RenderLines(meshIx, start, count, effect, technique = effect.defaultTechnique)
    {
        this.KeepAlive();
        const passCount = effect.GetPassCount(technique);
        if (!passCount || !this.IsGood() || meshIx >= this.meshes.length) return false;

        const
            d = device,
            gl = d.gl,
            mesh = this.meshes[meshIx];

        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexes);

        for (let pass = 0; pass < passCount; ++pass)
        {
            effect.ApplyPass(technique, pass);
            const passInput = effect.GetPassInput(technique, pass);
            if (!mesh.declaration.SetDeclaration(d, passInput, mesh.declaration.stride))
            {
                this.OnError(new ErrGeometryMeshEffectBinding({
                    path: this.path,
                    pass: pass,
                    passInput: passInput,
                    meshStride: mesh.declaration.stride
                }));
                return false;
            }

            d.ApplyShadowState();

            for (let i = 0; i < count; ++i)
            {
                if (i + start < mesh.areas.length)
                {
                    let area = mesh.areas[i + start],
                        areaStart = area.start,
                        areaCount = area.count;

                    while (i + 1 < count)
                    {
                        area = mesh.areas[i + 1 + start];

                        if (!area)
                        {
                            this.OnError(new ErrGeometryMeshAreaMissing({
                                path: this.path,
                                areaIndex: i + 1 + start
                            }));
                            return false;
                        }

                        if (area.start !== areaStart + areaCount * 2) break;
                        areaCount += area.count;
                        ++i;
                    }
                    gl.drawElements(gl.LINES, areaCount, mesh.indexType, areaStart);
                }
            }
        }
        return true;
    }

    /**
     * RenderDebugInfo
     * @param {function} debugHelper
     * @returns {Boolean}
     */
    RenderDebugInfo(debugHelper)
    {
        if (!this.IsGood()) return false;

        for (let i = 0; i < this.models.length; ++i)
        {
            if (this.models[i].skeleton)
            {
                for (let j = 0; j < this.models[i].skeleton.bones.length; ++j)
                {
                    const b0 = this.models[i].skeleton.bones[j];
                    if (b0.parentIndex >= 0)
                    {
                        const b1 = this.models[i].skeleton.bones[b0.parentIndex];
                        debugHelper["AddLine"](
                            [ b0.worldTransform[12], b0.worldTransform[13], b0.worldTransform[14] ],
                            [ b1.worldTransform[12], b1.worldTransform[13], b1.worldTransform[14] ],
                            [ 0, 0.7, 0, 1 ], [ 0, 0.7, 0, 1 ]);
                    }
                }
            }
        }
    }

    /**
     * Unloads webgl and javascript resources
     * @param {eventLog} eventLog
     * @returns {Boolean}
     */
    Unload(eventLog)
    {
        for (let i = 0; i < this.meshes.length; ++i)
        {
            const gl = device.gl;

            if (this.meshes[i].buffer)
            {
                gl.deleteBuffer(this.meshes[i].buffer);
                this.meshes[i].buffer = null;
            }

            if (this.meshes[i].indexes)
            {
                gl.deleteBuffer(this.meshes[i].indexes);
                this.meshes[i].indexes = null;
            }
        }
        this.OnUnloaded(eventLog);
        return true;
    }

    /**
     * ReadVertexBuffer
     * @param {Tw2BinaryReader} reader
     * @param {Tw2VertexDeclaration} declaration
     * @param {String} path
     * @returns {?Float32Array}
     */
    static ReadVertexBuffer(reader, declaration, path)
    {
        const declCount = reader.ReadUInt8();
        let vertexSize = 0;

        for (let declIx = 0; declIx < declCount; ++declIx)
        {
            let element = new Tw2VertexElement();
            element.usage = reader.ReadUInt8();
            element.usageIndex = reader.ReadUInt8();
            element.fileType = reader.ReadUInt8();
            element.type = device.gl.FLOAT;
            element.elements = (element.fileType >> 5) + 1;
            element.offset = vertexSize * 4;
            declaration.elements[declIx] = element;
            vertexSize += element.elements;
        }
        declaration.RebuildHash();
        declaration.stride = vertexSize * 4;

        const vertexCount = reader.ReadUInt32();
        if (vertexCount === 0) return null;

        const buffer = new Float32Array(vertexSize * vertexCount);
        let index = 0;
        for (let vtxIx = 0; vtxIx < vertexCount; ++vtxIx)
        {
            for (let declIx = 0; declIx < declCount; ++declIx)
            {
                let el = declaration.elements[declIx];
                switch (el.fileType & 0xf)
                {
                    case 0:
                        if ((el.fileType & 0x10) !== 0)
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadInt8() / 127.0;
                            }
                        }
                        else
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadInt8();
                            }
                        }
                        break;

                    case 1:
                        if ((el.fileType & 0x10) !== 0)
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadInt8() / 32767.0;
                            }
                        }
                        else
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadInt16();
                            }
                        }
                        break;

                    case 2:
                        for (let i = 0; i < el.elements; ++i)
                        {
                            buffer[index++] = reader.ReadInt32();
                        }
                        break;

                    case 3:
                        for (let i = 0; i < el.elements; ++i)
                        {
                            buffer[index++] = reader.ReadFloat16();
                        }
                        break;

                    case 4:
                        for (let i = 0; i < el.elements; ++i)
                        {
                            buffer[index++] = reader.ReadFloat32();
                        }
                        break;

                    case 8:
                        if ((el.fileType & 0x10) !== 0)
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadUInt8() / 255.0;
                            }
                        }
                        else
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadUInt8();
                            }
                        }
                        break;

                    case 9:
                        if ((el.fileType & 0x10) !== 0)
                        {
                            for (let i = 0; i < declaration.elements[declIx].elements; ++i)
                            {
                                buffer[index++] = reader.ReadUInt8() / 65535.0;
                            }
                        }
                        else
                        {
                            for (let i = 0; i < el.elements; ++i)
                            {
                                buffer[index++] = reader.ReadUInt16();
                            }
                        }
                        break;

                    case 10:
                        for (let i = 0; i < el.elements; ++i)
                        {
                            buffer[index++] = reader.ReadUInt32();
                        }
                        break;

                    default:
                        throw new ErrGeometryFileType({ path: path, key: "fileType", value: el.fileType & 0xf });
                }
            }
        }
        return buffer;
    }

    /**
     * ReadIndexBuffer
     * @property {Tw2BinaryReader}
     * @returns {Uint16Array|Uint32Array}
     * @private
     */
    static ReadIndexBuffer(reader)
    {
        const
            ibType = reader.ReadUInt8(),
            indexCount = reader.ReadUInt32();

        if (ibType === 0)
        {
            const indexes = new Uint16Array(indexCount);
            for (let i = 0; i < indexCount; ++i)
            {
                indexes[i] = reader.ReadUInt16();
            }
            return indexes;
        }
        else
        {
            const indexes = new Uint32Array(indexCount);
            for (let i = 0; i < indexCount; ++i)
            {
                indexes[i] = reader.ReadUInt32();
            }
            return indexes;
        }
    }

    /**
     * ReadCurve
     * @returns {Tw2GeometryCurve}
     */
    static ReadCurve(reader)
    {
        const type = reader.ReadUInt8();
        if (type === 0) return null;

        const curve = new Tw2GeometryCurve();
        curve.dimension = reader.ReadUInt8();
        curve.degree = reader.ReadUInt8();
        const knotCount = reader.ReadUInt32();
        curve.knots = new Float32Array(knotCount);
        for (let i = 0; i < knotCount; ++i)
        {
            curve.knots[i] = reader.ReadFloat32();
        }
        const controlCount = reader.ReadUInt32();
        curve.controls = new Float32Array(controlCount);
        for (let i = 0; i < controlCount; ++i)
        {
            curve.controls[i] = reader.ReadFloat32();
        }
        return curve;
    }

    /**
     * Updates the geometry res from json
     * @param {Object} json
     * @param {Object} extensionOptions - options for the geometry reader
     */
    UpdateFromJSON(json, extensionOptions)
    {
        this.Clear();

        this._extension = "gr2_json";
        this._isCustom = true;
        const Reader = readers[this._extension];
        if (!Reader) throw new ErrResourceFormatUnsupported({ format: this._extension });
        Reader.Prepare(json, this, extensionOptions);
        this.RebuildBounds();

        if (json.factory)
        {
            this._custom = this._custom || {};
            this._custom.factory = json.factory;
            this._custom.options = json.options;
        }
    }


    /**
     * Creates a geometry resource from json data
     * @param {Array<Object>|Object} json
     * @param {Object} [options]
     * @param {Tw2GeometryRes} [res]
     * @returns {Tw2GeometryRes}
     */
    static from(json, options)
    {
        const res = new Tw2GeometryRes();
        res.UpdateFromJSON(json, options);
        return res;
    }

}


/**
 * Throws when a geometry mesh lacks an element required for a particle system
 */
export class ErrGeometryMeshMissingParticleElement extends Tw2Error
{
    constructor(data)
    {
        super(data, "Input geometry mesh lacks element required by particle system");
    }
}


/**
 * Throws when a geometry mesh element doesn't have the required number of components
 */
export class ErrGeometryMeshElementComponentsMissing extends Tw2Error
{
    constructor(data)
    {
        super(data, "Input geometry mesh elements do not have the required number of components");
    }
}

/**
 * Throws when a geometry mesh area is missing
 */
export class ErrGeometryMeshAreaMissing extends Tw2Error
{
    constructor(data)
    {
        super(data, "Geometry mesh missing expected area at index %areaIndex%");
    }
}

/**
 * Throws when a geometry mesh has an invalid bone name for a model
 */
export class ErrGeometryMeshBoneNameInvalid extends Tw2Error
{
    constructor(data)
    {
        super(data, "Geometry mesh '%mesh%' has invalid bone name '%bone%' for model '%model%'");
    }
}


/**
 * Throws when there is an error binding a geometry mesh to an effect
 */
export class ErrGeometryMeshEffectBinding extends Tw2Error
{
    constructor(data)
    {
        super(data, "Error binding geometry mesh to effect");
    }
}

/**
 * Throws when a geometry mesh has an invalid file type
 */
export class ErrGeometryFileType extends Tw2Error
{
    constructor(data)
    {
        super(data, "Invalid geometry file type (%fileType%)");
    }
}
