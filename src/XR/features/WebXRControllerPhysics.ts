import { WebXRAbstractFeature } from "./WebXRAbstractFeature";
import { Vector3, Quaternion } from "../../Maths/math.vector";
import { WebXRController } from "../webXRController";
import { PhysicsImpostor } from "../../Physics/physicsImpostor";
import { WebXRInput } from "../webXRInput";
import { WebXRSessionManager } from "../webXRSessionManager";
import { AbstractMesh } from "../../Meshes/abstractMesh";
import { SphereBuilder } from "../../Meshes/Builders/sphereBuilder";
import { WebXRFeatureName, WebXRFeaturesManager } from "../webXRFeaturesManager";
import { Logger } from '../../Misc/logger';

/**
 * Options for the controller physics feature
 */
export class IWebXRControllerPhysicsOptions {
    /**
     * the xr input to use with this pointer selection
     */
    xrInput: WebXRInput;
    /**
     * The physics properties of the future impostors
     */
    physicsProperties?: {
        /**
         * If set to true, a mesh impostor will be created when the controller mesh was loaded
         * Note that this requires a physics engine that supports mesh impostors!
         */
        useControllerMesh?: boolean;
        /**
         * The type of impostor to create. Default is sphere
         */
        impostorType?: number;
        /**
         * the size of the impostor. Defaults to 10cm
         */
        impostorSize?: number | { width: number, height: number, depth: number };
        /**
         * Friction definitions
         */
        friction?: number;
        /**
         * Restitution
         */
        restitution?: number;
    };
}

/**
 * Add physics impostor to your webxr controllers,
 * including naive calculation of their linear and angular velocity
 */
export class WebXRControllerPhysics extends WebXRAbstractFeature {

    /**
     * The module's name
     */
    public static readonly Name = WebXRFeatureName.PHYSICS_CONTROLLERS;
    /**
     * The (Babylon) version of this module.
     * This is an integer representing the implementation version.
     * This number does not correspond to the webxr specs version
     */
    public static readonly Version = 1;

    private _lastTimestamp: number = 0;
    private _delta: number = 0;

    private _controllers: {
        [id: string]: {
            xrController: WebXRController;
            impostorMesh?: AbstractMesh,
            impostor: PhysicsImpostor
            oldPos?: Vector3;
            oldRotation?: Quaternion;
        }
    } = {};

    private _tmpVector: Vector3 = new Vector3();
    private _tmpQuaternion: Quaternion = new Quaternion();

    /**
     * Construct a new Controller Physics Feature
     * @param _xrSessionManager the corresponding xr session manager
     * @param _options options to create this feature with
     */
    constructor(_xrSessionManager: WebXRSessionManager, private readonly _options: IWebXRControllerPhysicsOptions) {
        super(_xrSessionManager);
        if (!this._options.physicsProperties) {
            this._options.physicsProperties = {
            };
        }
    }

    /**
     * Update the physics properties provided in the constructor
     * @param newProperties the new properties object
     */
    public setPhysicsProperties(newProperties: {
        impostorType?: number,
        impostorSize?: number | { width: number, height: number, depth: number },
        friction?: number,
        restitution?: number
    }) {
        this._options.physicsProperties = {
            ...this._options.physicsProperties,
            ...newProperties
        };
    }

    /**
     * attach this feature
     * Will usually be called by the features manager
     *
     * @returns true if successful.
     */
    attach(): boolean {
        if (!super.attach()) {
            return false;
        }

        if (!this._options.xrInput) {
            return true;
        }

        this._options.xrInput.controllers.forEach(this._attachController);
        this._addNewAttachObserver(this._options.xrInput.onControllerAddedObservable, this._attachController);
        this._addNewAttachObserver(this._options.xrInput.onControllerRemovedObservable, (controller) => {
            // REMOVE the controller
            this._detachController(controller.uniqueId);
        });

        return true;
    }

    /**
     * detach this feature.
     * Will usually be called by the features manager
     *
     * @returns true if successful.
     */
    detach(): boolean {
        if (!super.detach()) {
            return false;
        }

        Object.keys(this._controllers).forEach((controllerId) => {
            this._detachController(controllerId);
        });

        return true;
    }

    /**
     * Manually add a controller (if no xrInput was provided or physics engine was not enabled)
     * @param xrController the controller to add
     */
    public addController(xrController: WebXRController) {
        this._attachController(xrController);
    }

    private _debugMode = false;

    /**
     * @hidden
     * enable debugging - will show console outputs and the impostor mesh
     */
    public _enablePhysicsDebug() {
        this._debugMode = true;
        Object.keys(this._controllers).forEach((controllerId) => {
            const controllerData = this._controllers[controllerId];
            if (controllerData.impostorMesh) {
                controllerData.impostorMesh.isVisible = true;
            }
        });
    }

    private _attachController = (xrController: WebXRController
    ) => {
        if (this._controllers[xrController.uniqueId]) {
            // already attached
            return;
        }
        if (!this._xrSessionManager.scene.isPhysicsEnabled()) {
            Logger.Warn("physics engine not enabled, skipped. Please add this controller manually.");
        }
        if (this._options.physicsProperties!.useControllerMesh) {
            xrController.onMotionControllerInitObservable.addOnce((motionController) => {
                motionController.onModelLoadedObservable.addOnce(() => {
                    const impostor = new PhysicsImpostor(motionController.rootMesh!, PhysicsImpostor.MeshImpostor, {
                        mass: 0,
                        ...this._options.physicsProperties
                    });
                    const controllerMesh = xrController.grip || xrController.pointer;
                    this._controllers[xrController.uniqueId] = {
                        xrController,
                        impostor,
                        oldPos: controllerMesh.position.clone(),
                        oldRotation: controllerMesh.rotationQuaternion!.clone()
                    };
                });
            });
        } else {
            const impostorType: number = this._options.physicsProperties!.impostorType || PhysicsImpostor.SphereImpostor;
            const impostorSize: number | { width: number, height: number, depth: number } = this._options.physicsProperties!.impostorSize || 0.1;
            const impostorMesh = SphereBuilder.CreateSphere('impostor-mesh-' + xrController.uniqueId, {
                diameterX: typeof impostorSize === 'number' ? impostorSize : impostorSize.width,
                diameterY: typeof impostorSize === 'number' ? impostorSize : impostorSize.height,
                diameterZ: typeof impostorSize === 'number' ? impostorSize : impostorSize.depth
            });
            impostorMesh.isVisible = this._debugMode;
            impostorMesh.isPickable = false;
            impostorMesh.rotationQuaternion = new Quaternion();
            const controllerMesh = xrController.grip || xrController.pointer;
            impostorMesh.position.copyFrom(controllerMesh.position);
            impostorMesh.rotationQuaternion!.copyFrom(controllerMesh.rotationQuaternion!);
            const impostor = new PhysicsImpostor(impostorMesh, impostorType, {
                mass: 0,
                ...this._options.physicsProperties
            });
            this._controllers[xrController.uniqueId] = {
                xrController,
                impostor,
                impostorMesh
            };
        }
    }

    private _detachController(xrControllerUniqueId: string) {
        const controllerData = this._controllers[xrControllerUniqueId];
        if (!controllerData) { return; }
        if (controllerData.impostorMesh) {
            controllerData.impostorMesh.dispose();
        }
        // remove from the map
        delete this._controllers[xrControllerUniqueId];
    }

    protected _onXRFrame(_xrFrame: any): void {
        this._delta = (this._xrSessionManager.currentTimestamp - this._lastTimestamp);
        this._lastTimestamp = this._xrSessionManager.currentTimestamp;
        Object.keys(this._controllers).forEach((controllerId) => {
            const controllerData = this._controllers[controllerId];
            const controllerMesh = controllerData.xrController.grip || controllerData.xrController.pointer;

            const comparedPosition = controllerData.oldPos || controllerData.impostorMesh!.position;
            const comparedQuaternion = controllerData.oldRotation || controllerData.impostorMesh!.rotationQuaternion!;

            if (!controllerMesh.position.equalsWithEpsilon(comparedPosition)) {
                controllerMesh.position.subtractToRef(comparedPosition, this._tmpVector);
                this._tmpVector.scaleInPlace(this._delta);
                controllerData.impostor.setLinearVelocity(this._tmpVector);
                if (this._debugMode) {
                    console.log(this._tmpVector, 'linear');
                }
            }
            if (!comparedQuaternion.equalsWithEpsilon(controllerMesh.rotationQuaternion!)) {
                // roughly based on this - https://www.gamedev.net/forums/topic/347752-quaternion-and-angular-velocity/
                comparedQuaternion.conjugateInPlace().multiplyToRef(controllerMesh.rotationQuaternion!, this._tmpQuaternion);
                const len = Math.sqrt(this._tmpQuaternion.x * this._tmpQuaternion.x + this._tmpQuaternion.y * this._tmpQuaternion.y + this._tmpQuaternion.z * this._tmpQuaternion.z);
                this._tmpVector.set(this._tmpQuaternion.x, this._tmpQuaternion.y, this._tmpQuaternion.z);
                // define a better epsilon
                if (len < 0.001) {
                    this._tmpVector.scaleInPlace(2);
                } else {
                    const angle = 2 * Math.atan2(len, this._tmpQuaternion.w);
                    this._tmpVector.scaleInPlace((angle / (len * this._delta)));
                }
                controllerData.impostor.setAngularVelocity(this._tmpVector);
                if (this._debugMode) {
                    console.log(this._tmpVector, this._tmpQuaternion, 'angular');
                }
            }
            comparedPosition.copyFrom(controllerMesh.position);
            comparedQuaternion.copyFrom(controllerMesh.rotationQuaternion!);
        });
    }

}

//register the plugin
WebXRFeaturesManager.AddWebXRFeature(WebXRControllerPhysics.Name, (xrSessionManager, options) => {
    return () => new WebXRControllerPhysics(xrSessionManager, options);
}, WebXRControllerPhysics.Version, true);