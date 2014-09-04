/** @scratch /panels/5
 *
 * include::panels/retention.asciidoc[]
 */

/** @scratch /panels/retention/0
 *
 * == Hits
 * Status: *Stable*
 *
 * The retention panel displays the number of retention for each of the queries on the dashboard in a
 * configurable format specified by the `chart' property.
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'jquery',
  'kbn',

  'jquery.flot',
  'jquery.flot.pie'
], function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.retention', []);
  app.useModule(module);

  module.controller('retention', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : "Retention!"
    };

    // Set and populate defaults
    var _d = {
      style   : { "font-size": '10pt'},
      time_field : '@timestamp',
      /** @scratch /panels/retention/3
       *
       * === Parameters
       *
       * arrangement:: The arrangement of the legend. horizontal or vertical
       */
      arrangement : 'horizontal',
      /** @scratch /panels/retention/3
       * chart:: bar, pie or none
       */
      chart       : 'bar',
      /** @scratch /panels/retention/3
       * counter_pos:: The position of the legend, above or below
       */
      counter_pos : 'above',
      /** @scratch /panels/retention/3
       * donut:: If the chart is set to pie, setting donut to true will draw a hole in the midle of it
       */
      labels  : true,
      /** @scratch /panels/retention/3
       * spyable:: Setting spyable to false disables the inspect icon.
       */
      spyable : true,
      /** @scratch /panels/retention/5
       *
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      },
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.hits = 0;

      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

    };

    $scope.get_data = function(segment,query_id) {
      delete $scope.panel.error;
      $scope.panelMeta.loading = true;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      var _segment = _.isUndefined(segment) ? 0 : segment;
      var request = $scope.ejs.Request();

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      var queries = querySrv.getQueryObjs($scope.panel.queries.ids);

      if (queries.length > 2) {
        $scope.panel.error = "Must provide max 2 queries!";
        return;
      }

      var dateAgg = $scope.ejs.DateHistogramAggregation('by_day')
                           .field('@timestamp')
                           .interval('1d');

      _.each(queries, function(q) {
        // Exclude the time filters.
        var _q = $scope.ejs.FilteredQuery(
          querySrv.toEjsObj(q),
          filterSrv.getBoolFilter(filterSrv.idsByType('querystring')));

        var filterAgg = $scope.ejs.FilterAggregation('query_' + q.id)
                                  .filter($scope.ejs.QueryFilter(_q));
        var termsAgg = $scope.ejs.TermsAggregation('uniqs').field('user.uid').size(0);

        dateAgg.agg(filterAgg.agg(termsAgg));
      });

      request.agg(dateAgg).size(1);

      // Populate the inspector panel
      $scope.inspector = request.toJSON();

      // Then run it
      var results = $scope.ejs.doSearch(dashboard.indices, request);
      var numQueries = queries.length;

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;
        if(_segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        }

        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error);
          return;
        }

        // Make sure we're still on the same query/queries
        if($scope.query_id === query_id) {
          var days = results.aggregations.by_day.buckets;
          var res = _.map(days, function (d, i) {
            var q1 = _.pluck(d.query_0.uniqs.buckets, 'key');
            var q1h = {};
            for (var xi = 0; xi < q1.length; xi++) { q1h[q1[xi]] = true; }
            return _.map(_.range(i, days.length), function (x) {
              var q2 = _.pluck(days[x][numQueries === 1 ? 'query_0' : 'query_1'].uniqs.buckets, 'key');
              var c = 0;
              for (i = 0; i < q2.length; i++) { if (q1h[q2[i]]) { c++; } }

              return {
                a_count: q1.length,
                b_count: q2.length,
                intersection: c,
                perc: c / q1.length * 100,
                a_date: d.key,
                b_date: days[x].key
              };
            });
          });

          $scope.data = {
            queries: queries,
            rows: res,
            dates: _.pluck(days, 'key')
          };

          $scope.$emit('render');
        }
      });
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };
  });


  module.directive('retentionChart', function(querySrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          try {
            _.each(scope.data,function(series) {
              series.label = series.info.alias;
              series.color = series.info.color;
            });
          } catch(e) {return;}

          // Populate element
          try {
            // Add plot to scope so we can build out own legend
            if(scope.panel.chart === 'bar') {
              scope.plot = $.plot(elem, scope.data, {
                legend: { show: false },
                series: {
                  lines:  { show: false, },
                  bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                  shadowSize: 1
                },
                yaxis: { show: true, min: 0, color: "#c8c8c8" },
                xaxis: { show: false },
                grid: {
                  borderWidth: 0,
                  borderColor: '#eee',
                  color: "#eee",
                  hoverable: true,
                },
                colors: querySrv.colors
              });
            }
            if(scope.panel.chart === 'pie') {
              scope.plot = $.plot(elem, scope.data, {
                legend: { show: false },
                series: {
                  pie: {
                    innerRadius: scope.panel.donut ? 0.4 : 0,
                    tilt: scope.panel.tilt ? 0.45 : 1,
                    radius: 1,
                    show: true,
                    combine: {
                      color: '#999',
                      label: 'The Rest'
                    },
                    stroke: {
                      width: 0
                    },
                    label: {
                      show: scope.panel.labels,
                      radius: 2/3,
                      formatter: function(label, series){
                        return '<div ng-click="build_search(panel.query.field,\''+label+'\')'+
                          ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                          label+'<br/>'+Math.round(series.percent)+'%</div>';
                      },
                      threshold: 0.1
                    }
                  }
                },
                //grid: { hoverable: true, clickable: true },
                grid:   { hoverable: true, clickable: true },
                colors: querySrv.colors
              });
            }
          } catch(e) {
            elem.text(e);
          }
        }

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar' ?
              item.datapoint[1] : item.datapoint[1][0][1];
            $tooltip
              .html(kbn.query_color_dot(item.series.color, 20) + ' ' + item.series.label + " (" + value.toFixed(0) + ")")
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });

      }
    };
  });
});
