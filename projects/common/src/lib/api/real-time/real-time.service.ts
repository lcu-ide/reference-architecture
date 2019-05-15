import * as signalR from '@aspnet/signalr';
import { NgZone } from '@angular/core';
import { Injectable, Injector } from '@angular/core';
import { LCUServiceSettings } from '../lcu-service-settings';
import { Observable, BehaviorSubject, ReplaySubject, Observer, Subject } from 'rxjs';

//  TODO:  Need to manage reconnection to hub scenarios here

@Injectable({
  providedIn: 'root'
})
export class RealTimeService {
  //  Fields
  protected hub: signalR.HubConnection;

  protected started: ReplaySubject<signalR.HubConnection>;

  protected url: string;

  private zone: NgZone;

  //  Properties
  protected attemptingToReconnect: boolean;

  protected connectionAttempts: number;

  public ReconnectionMessage: Subject<string>;

  public Settings: LCUServiceSettings;

  public Started: Observable<signalR.HubConnection>;

  //  Constructors
  constructor(protected injector: Injector) {

    this.connectionAttempts = 0;
    this.ReconnectionMessage = new Subject();

    try {
      this.Settings = injector.get(LCUServiceSettings);

      this.zone = injector.get(NgZone);
    } catch (err) {}

    this.started = new ReplaySubject();

    this.Started = this.started.asObservable();

    this.start();
  }

  //  API Methods
  public Start() {
    return new Promise<signalR.HubConnection>((resolve, reject) => {
      this.buildHub('').then((hub: signalR.HubConnection) => {
        this.hub = hub;

        // this.hub.onclose(err => {
        //   console.log('onclose', err);

        //   //  TODO: Need to better handle reconnect without endless loop
        //   // this.start();
        // });

        try {
          this.hub
            .start()
            .then(() => {
              console.log(`Connection started`);

              resolve(this.hub);
            })
            .catch(err => {
              console.log('Error while starting connection: ' + err);

              if (this.connectionAttempts > 5) {
                reject(err);
              }

              this.retryConnection();
            });
        } catch (err) {
          console.log('Error while starting connection: ' + err);

          // if (this.connectionAttempts > 5) {
          //   reject(err);
          // }

          // this.retryConnection();
        }
      });
    });
  }

  public RegisterHandler(methodName: string) {
    return this.WithHub(hub => {
      return Observable.create(obs => {
        hub.on(methodName, req => {
          obs.next(req);

          this.zone.run(() => {});
        });
      });
    });
  }

  public Invoke(methodName: string, ...args: any[]) {
    return this.WithHub(hub => {
      return Observable.create(obs => {
        hub
          .invoke(methodName, ...args)
          .then(res => {
            obs.next(res);

            this.zone.run(() => {});
          })
          .catch(e => {
            obs.error(e);
          });
      });
    });
  }

  public WithHub(action: (hub: signalR.HubConnection) => void | Observable<any>): Observable<any> {
    try {
      return Observable.create(obs => {
        if (this.hub.state !== signalR.HubConnectionState.Connected) {
          this.Start().then(hub => {
            console.log('Restarting connection in flight...');

            this.runWithHub(obs, action);
          });
        } else {
          this.runWithHub(obs, action);
        }
      });
    } catch (err) {
      return Observable.create(obs => {
        obs.error(err);

        obs.complete();
      });
    }
  }

  //  Helpers
  protected async buildHub(urlRoot: string) {
    this.url = this.buildHubUrl(urlRoot);

    return (
      new signalR.HubConnectionBuilder()
        .withUrl(this.url)
        // .withUrl(this.url, {
        //   transport: signalR.HttpTransportType.LongPolling
        // })
        .build()
    );
  }

  protected buildHubUrl(urlRoot: string) {
    const url = this.loadHubUrl(urlRoot);

    return url;
  }

  protected loadHubPath() {
    return `/state?lcu-app-id=${this.Settings.AppConfig.ID}&lcu-app-ent-api-key=${this.Settings.AppConfig.EnterpriseAPIKey}`;
  }

  protected loadHubUrl(urlRoot: string) {
    const apiRoot = this.Settings ? this.Settings.APIRoot || '' : '';

    const hubPath = this.loadHubPath();

    return `${apiRoot}${urlRoot || ''}${hubPath}`;
  }

  protected runWithHub(obs: Observer<any>, action: (hub: signalR.HubConnection) => void | Observable<any>) {
    const res = action(this.hub);

    if (res) {
      res.subscribe(
        r => {
          obs.next(r);

          this.zone.run(() => {});
        },
        e => {
          obs.error(e);
        }
      );
    }
  }

  protected start() {
    setTimeout(() => {
      this.Start().then(hub => this.started.next(hub));
    }, 50);
  }

  protected stop(): void {
   // this.hub.stop();
  }

  /**
   * Retry connection
   */
  protected retryConnection(): void {
    this.connectionAttempts += 1;
    console.log(this.connectionAttempts);
    (this.connectionAttempts < 5) ? this.reconnect() : this.stopReconnection();
  }

  /**
   * Attempt to reconnect
   */
  protected reconnect(): void {
    this.attemptingToReconnect = true;

    this.reconnectionMessage();
    this.start();
  }

  /**
   * Stop trying to reconnect
   */
  protected stopReconnection(): void {
    this.attemptingToReconnect = false;

    this.reconnectionMessage();
    this.stop();
   // this.ReconnectionMessage.unsubscribe();
  }

  /**
   * Notify user of reconnection attempt(s)
   */
  protected reconnectionMessage(): void {
    let message: string;
    message = (this.attemptingToReconnect) ? 'Attempting to reconnect' : 'Stopping reconnection attempts';

    console.log(message);

    if (this.connectionAttempts === 6) {
      this.ReconnectionMessage.next(message);
    }
  }
}
